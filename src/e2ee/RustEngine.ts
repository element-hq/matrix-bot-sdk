import {
    EncryptionSettings,
    KeysClaimRequest,
    OlmMachine,
    RequestType,
    RoomId,
    UserId,
    EncryptionAlgorithm as RustEncryptionAlgorithm,
    HistoryVisibility,
    KeysUploadRequest,
    KeysQueryRequest,
    ToDeviceRequest,
    KeysBackupRequest,
} from "@matrix-org/matrix-sdk-crypto-nodejs";
import * as AsyncLock from "async-lock";

import { MatrixClient } from "../MatrixClient";
import { extractRequestError, LogService } from "../logging/LogService";
import { ICryptoRoomInformation } from "./ICryptoRoomInformation";
import { EncryptionAlgorithm } from "../models/Crypto";
import { EncryptionEvent } from "../models/events/EncryptionEvent";
import { ICurve25519AuthData, IKeyBackupInfoRetrieved, KeyBackupVersion } from "../models/KeyBackup";
import { Membership } from "../models/events/MembershipEvent";

/**
 * @internal
 */
export const SYNC_LOCK_NAME = "sync";

/**
 * @internal
 */
export class RustEngine {
    public readonly lock = new AsyncLock();

    private keyBackupVersion: KeyBackupVersion|undefined;
    // TODO: keyBackupPromise that can be awaited by others

    public constructor(public readonly machine: OlmMachine, private client: MatrixClient) {
    }

    public async run() {
        await this.runOnly(); // run everything, but with syntactic sugar
    }

    private async runOnly(...types: RequestType[]) {
        // Note: we should not be running this until it runs out, so cache the value into a variable
        const requests = await this.machine.outgoingRequests();
        for (const request of requests) {
            if (types.length && !types.includes(request.type)) continue;
            switch (request.type) {
                case RequestType.KeysUpload:
                    await this.processKeysUploadRequest(request);
                    break;
                case RequestType.KeysQuery:
                    await this.processKeysQueryRequest(request);
                    break;
                case RequestType.KeysClaim:
                    await this.processKeysClaimRequest(request);
                    break;
                case RequestType.ToDevice:
                    await this.processToDeviceRequest(request as ToDeviceRequest);
                    break;
                case RequestType.RoomMessage:
                    throw new Error("Bindings error: Sending room messages is not supported");
                case RequestType.SignatureUpload:
                    throw new Error("Bindings error: Backup feature not possible");
                case RequestType.KeysBackup:
                    await this.processKeysBackupRequest(request);
                    break;
                default:
                    throw new Error("Bindings error: Unrecognized request type: " + request.type);
            }
        }
    }

    public async addTrackedUsers(userIds: string[]) {
        await this.lock.acquire(SYNC_LOCK_NAME, async () => {
            const uids = userIds.map(u => new UserId(u));
            await this.machine.updateTrackedUsers(uids);

            const keysClaim = await this.machine.getMissingSessions(uids);
            if (keysClaim) {
                await this.processKeysClaimRequest(keysClaim);
            }
        });
    }

    public async prepareEncrypt(roomId: string, roomInfo: ICryptoRoomInformation) {
        let memberships: Membership[] = ["join", "invite"];
        let historyVis = HistoryVisibility.Joined;
        switch (roomInfo.historyVisibility) {
            case "world_readable":
                historyVis = HistoryVisibility.WorldReadable;
                break;
            case "invited":
                historyVis = HistoryVisibility.Invited;
                break;
            case "shared":
                historyVis = HistoryVisibility.Shared;
                break;
            case "joined":
            default:
                memberships = ["join"];
        }

        const members = new Set<UserId>();
        for (const membership of memberships) {
            try {
                (await this.client.getRoomMembersByMembership(roomId, membership))
                    .map(u => new UserId(u.membershipFor))
                    .forEach(u => void members.add(u));
            } catch (err) {
                LogService.warn("RustEngine", `Failed to get room members for membership type "${membership}" in ${roomId}`, extractRequestError(err));
            }
        }
        if (members.size === 0) {
            return;
        }
        const membersArray = Array.from(members);

        const encEv = new EncryptionEvent({
            type: "m.room.encryption",
            content: roomInfo,
        });

        const settings = new EncryptionSettings();
        settings.algorithm = roomInfo.algorithm === EncryptionAlgorithm.MegolmV1AesSha2
            ? RustEncryptionAlgorithm.MegolmV1AesSha2
            : undefined;
        settings.historyVisibility = historyVis;
        settings.rotationPeriod = BigInt(encEv.rotationPeriodMs);
        settings.rotationPeriodMessages = BigInt(encEv.rotationPeriodMessages);

        await this.lock.acquire(SYNC_LOCK_NAME, async () => {
            await this.machine.updateTrackedUsers(membersArray); // just in case we missed some
            await this.runOnly(RequestType.KeysQuery);
            const keysClaim = await this.machine.getMissingSessions(membersArray);
            if (keysClaim) {
                await this.processKeysClaimRequest(keysClaim);
                if (this.keyBackupVersion !== undefined) {
                    await this.machine.backupRoomKeys();
                }
            }
        });

        await this.lock.acquire(roomId, async () => {
            const requests = JSON.parse(await this.machine.shareRoomKey(new RoomId(roomId), membersArray, settings));
            for (const req of requests) {
                await this.actuallyProcessToDeviceRequest(req.txn_id, req.event_type, req.messages);
            }
        });
    }

    public async enableKeyBackup(info: IKeyBackupInfoRetrieved) {
        this.keyBackupVersion = info.version;
        // TODO Error with message if the key backup uses an unsupported auth_data type
        await this.machine.enableBackupV1((info.auth_data as ICurve25519AuthData).public_key, info.version);
    }

    public async disableKeyBackup() {
        this.keyBackupVersion = undefined;
        await this.machine.disableBackup();
    }

    public async backupRoomKeys() {
        const request = await this.machine.backupRoomKeys();
        if (request) {
            await this.processKeysBackupRequest(request);
        }
    }

    private async processKeysClaimRequest(request: KeysClaimRequest) {
        const resp = await this.client.doRequest("POST", "/_matrix/client/v3/keys/claim", null, JSON.parse(request.body));
        await this.machine.markRequestAsSent(request.id, request.type, JSON.stringify(resp));
    }

    private async processKeysUploadRequest(request: KeysUploadRequest) {
        const body = JSON.parse(request.body);
        // delete body["one_time_keys"]; // use this to test MSC3983
        const resp = await this.client.doRequest("POST", "/_matrix/client/v3/keys/upload", null, body);
        await this.machine.markRequestAsSent(request.id, request.type, JSON.stringify(resp));
    }

    private async processKeysQueryRequest(request: KeysQueryRequest) {
        const resp = await this.client.doRequest("POST", "/_matrix/client/v3/keys/query", null, JSON.parse(request.body));
        await this.machine.markRequestAsSent(request.id, request.type, JSON.stringify(resp));
    }

    private async processToDeviceRequest(request: ToDeviceRequest) {
        const req = JSON.parse(request.body);
        await this.actuallyProcessToDeviceRequest(req.txn_id, req.event_type, req.messages);
    }

    private async actuallyProcessToDeviceRequest(id: string, type: string, messages: Record<string, Record<string, unknown>>) {
        const resp = await this.client.sendToDevices(type, messages);
        await this.machine.markRequestAsSent(id, RequestType.ToDevice, JSON.stringify(resp));
    }

    private async processKeysBackupRequest(request: KeysBackupRequest) {
        let resp: Awaited<ReturnType<MatrixClient["doRequest"]>>;
        try {
            resp = await this.client.doRequest("PUT", "/_matrix/client/v3/room_keys/keys", { version: this.keyBackupVersion }, JSON.parse(request.body));
        } catch (e) {
            this.client.emit("crypto.failed_backup", e);
            return;
        }
        await this.machine.markRequestAsSent(request.id, request.type, JSON.stringify(resp));
    }
}
