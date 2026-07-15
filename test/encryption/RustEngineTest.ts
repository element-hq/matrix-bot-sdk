import * as simple from "simple-mock";
import { RequestType } from "@matrix-org/matrix-sdk-crypto-nodejs";

import { MatrixClient } from "../../src";
import { RustEngine } from "../../src/e2ee/RustEngine";

function makeFakeClient() {
    return {
        doRequest: simple.mock(),
        sendToDevices: simple.mock(),
        emit: simple.mock(),
    };
}

function makeFakeMachine() {
    return {
        markRequestAsSent: simple.mock().resolveWith(undefined),
    };
}

describe('RustEngine', () => {
    describe('processOutgoingRequests', () => {
        it('should emit crypto.failed_upload and not mark a failed KeysUpload request as sent', async () => {
            const client = makeFakeClient();
            const machine = makeFakeMachine();
            const engine = new RustEngine(<any>machine, <any>client);

            const err = new Error("M_UNKNOWN: One time key already exists");
            client.doRequest.rejectWith(err);

            const request = {
                id: "req1",
                type: RequestType.KeysUpload,
                body: JSON.stringify({ one_time_keys: {} }),
            };

            await expect(engine.processOutgoingRequests([<any>request])).resolves.toBeUndefined();

            expect(machine.markRequestAsSent.callCount).toEqual(0);
            expect(client.emit.callCount).toEqual(1);
            expect(client.emit.lastCall.args[0]).toEqual("crypto.failed_upload");
            expect(client.emit.lastCall.args[1]).toBe(err);
        });

        it('should mark a successful KeysUpload request as sent, without emitting a failure', async () => {
            const client = makeFakeClient();
            const machine = makeFakeMachine();
            const engine = new RustEngine(<any>machine, <any>client);

            const resp = { one_time_key_counts: { signed_curve25519: 50 } };
            client.doRequest.resolveWith(resp);

            const request = {
                id: "req1",
                type: RequestType.KeysUpload,
                body: JSON.stringify({ one_time_keys: {} }),
            };

            await engine.processOutgoingRequests([<any>request]);

            expect(client.emit.callCount).toEqual(0);
            expect(machine.markRequestAsSent.callCount).toEqual(1);
            expect(machine.markRequestAsSent.lastCall.args).toEqual(["req1", RequestType.KeysUpload, JSON.stringify(resp)]);
        });

        it('should not let a failed request block other requests in the same batch from being processed', async () => {
            const client = makeFakeClient();
            const machine = makeFakeMachine();
            const engine = new RustEngine(<any>machine, <any>client);

            const failingRequest = {
                id: "failing",
                type: RequestType.KeysUpload,
                body: JSON.stringify({ one_time_keys: {} }),
            };
            const succeedingRequest = {
                id: "succeeding",
                type: RequestType.KeysQuery,
                body: JSON.stringify({ device_keys: {} }),
            };

            const uploadErr = new Error("M_UNKNOWN: One time key already exists");
            client.doRequest = simple.mock().callFn((method, path) => {
                if (path === "/_matrix/client/v3/keys/upload") return Promise.reject(uploadErr);
                return Promise.resolve({});
            });

            await engine.processOutgoingRequests([<any>failingRequest, <any>succeedingRequest]);

            // The failing KeysUpload should not have been marked as sent...
            expect(machine.markRequestAsSent.callCount).toEqual(1);
            // ...but the KeysQuery queued alongside it should still have been processed.
            expect(machine.markRequestAsSent.lastCall.args[0]).toEqual("succeeding");
            expect(client.emit.callCount).toEqual(1);
            expect(client.emit.lastCall.args[0]).toEqual("crypto.failed_upload");
        });

        it('should emit distinct failure events per request type', async () => {
            const cases: [RequestType, string, any][] = [
                [RequestType.KeysClaim, "crypto.failed_keys_claim", { id: "r", type: RequestType.KeysClaim, body: "{}" }],
                [RequestType.KeysQuery, "crypto.failed_keys_query", { id: "r", type: RequestType.KeysQuery, body: "{}" }],
                [RequestType.SignatureUpload, "crypto.failed_signature_upload", { id: "r", type: RequestType.SignatureUpload, body: JSON.stringify({ signed_keys: {} }) }],
            ];

            for (const [type, expectedEvent, request] of cases) {
                const client = makeFakeClient();
                const machine = makeFakeMachine();
                const engine = new RustEngine(<any>machine, <any>client);
                const err = new Error(`failure for ${type}`);
                client.doRequest.rejectWith(err);

                await engine.processOutgoingRequests([<any>request]);

                expect(machine.markRequestAsSent.callCount).toEqual(0);
                expect(client.emit.callCount).toEqual(1);
                expect(client.emit.lastCall.args[0]).toEqual(expectedEvent);
            }
        });

        it('should emit crypto.failed_to_device and not mark a failed ToDevice request as sent', async () => {
            const client = makeFakeClient();
            const machine = makeFakeMachine();
            const engine = new RustEngine(<any>machine, <any>client);

            const err = new Error("failed to send to-device message");
            client.sendToDevices.rejectWith(err);

            const request = {
                id: "req1",
                txnId: "txn1",
                eventType: "m.room.encrypted",
                type: RequestType.ToDevice,
                body: JSON.stringify({ messages: {} }),
            };

            await engine.processOutgoingRequests([<any>request]);

            expect(machine.markRequestAsSent.callCount).toEqual(0);
            expect(client.emit.callCount).toEqual(1);
            expect(client.emit.lastCall.args[0]).toEqual("crypto.failed_to_device");
        });

        it('should still throw for an unrecognized request type', async () => {
            const client = makeFakeClient();
            const machine = makeFakeMachine();
            const engine = new RustEngine(<any>machine, <any>client);

            const request = { id: "req1", type: 999999, body: "{}" };

            await expect(engine.processOutgoingRequests([<any>request])).rejects.toThrow();
        });
    });
});
