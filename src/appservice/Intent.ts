import { randomUUID } from "crypto";

import {
    DeviceKeyAlgorithm,
    extractRequestError,
    IAppserviceCryptoStorageProvider,
    IAppserviceStorageProvider,
    ICryptoStorageProvider,
    LogService,
    MatrixClient,
    Metrics,
} from "..";
import { Appservice, IAppserviceOptions } from "./Appservice";
// noinspection TypeScriptPreferShortImport
import { timedIntentFunctionCall } from "../metrics/decorators";
import { UnstableAppserviceApis } from "./UnstableAppserviceApis";
import { MatrixError } from "../models/MatrixError";

/**
 * An Intent is an intelligent client that tracks things like the user's membership
 * in rooms to ensure the action being performed is possible. This is very similar
 * to how Intents work in the matrix-js-sdk in that the Intent will ensure that the
 * user is joined to the room before posting a message, for example.
 * @category Application services
 */
export class Intent {
    /**
     * The metrics instance for this intent. Note that this will not raise metrics
     * for the underlying client - those will be available through this instance's
     * parent (the appservice).
     */
    public readonly metrics: Metrics;

    private readonly storage: IAppserviceStorageProvider;
    private readonly cryptoStorage: IAppserviceCryptoStorageProvider;

    private client: MatrixClient;
    private unstableApisInstance: UnstableAppserviceApis;
    private cryptoSetupPromise: Promise<void>;

    /**
     * Creates a new intent. Intended to be created by application services.
     * @param {IAppserviceOptions} options The options for the application service.
     * @param {string} impersonateUserId The user ID to impersonate.
     * @param {Appservice} appservice The application service itself.
     */
    constructor(private options: IAppserviceOptions, private impersonateUserId: string, private appservice: Appservice) {
        this.metrics = new Metrics(appservice.metrics);
        this.storage = options.storage;
        this.cryptoStorage = options.cryptoStorage;
        this.makeClient(false);
    }

    private makeClient(withCrypto: boolean, accessToken?: string) {
        let cryptoStore: ICryptoStorageProvider;
        const storage = this.storage?.storageForUser?.(this.userId);
        if (withCrypto) {
            cryptoStore = this.cryptoStorage?.storageForUser(this.userId);
            if (!cryptoStore) {
                throw new Error("Tried to set up client with crypto when not available");
            }
            if (!storage) {
                throw new Error("Tried to set up client with crypto, but no persistent storage");
            }
        }

        this.client = new MatrixClient(this.options.homeserverUrl, accessToken ?? this.options.registration.as_token, storage, cryptoStore, {
            enableContentScanner: this.options.intentOptions?.enableContentScanner,
        });
        this.client.metrics = new Metrics(this.appservice.metrics); // Metrics only go up by one parent
        this.unstableApisInstance = new UnstableAppserviceApis(this.client);
        if (this.impersonateUserId !== this.appservice.botUserId) {
            this.client.impersonateUserId(this.impersonateUserId);
        }
        if (this.options.joinStrategy) {
            this.client.setJoinStrategy(this.options.joinStrategy);
        }
    }

    /**
     * Gets the user ID this intent is for.
     */
    public get userId(): string {
        return this.impersonateUserId;
    }

    /**
     * Gets the underlying MatrixClient that powers this Intent.
     */
    public get underlyingClient(): MatrixClient {
        return this.client;
    }

    /**
     * Gets the unstable API access class. This is generally not recommended to be
     * used by appservices.
     * @return {UnstableAppserviceApis} The unstable API access class.
     */
    public get unstableApis(): UnstableAppserviceApis {
        return this.unstableApisInstance;
    }

    /**
     * Sets up crypto on the client if it hasn't already been set up.
     * @param providedDeviceId Optional device ID. If given, this will used instead of trying to
     * masquerade as the first non-key enabled device.
     * @returns {Promise<void>} Resolves when complete.
     */
    @timedIntentFunctionCall()
    public async enableEncryption(providedDeviceId?: string): Promise<void> {
        if (!this.cryptoSetupPromise) {
            this.cryptoSetupPromise = (async () => {
                // Prepare a client first
                await this.ensureRegistered();
                const storage = this.storage?.storageForUser?.(this.userId);

                // This makes sure the current client isn't impersonating a
                // non-existing device before we try to do a call
                this.client.impersonateUserId(this.userId); 

                const cryptoStore = this.cryptoStorage?.storageForUser(this.userId);
                if (!cryptoStore) {
                    // noinspection ExceptionCaughtLocallyJS
                    throw new Error("Failed to create crypto store");
                }

                // XXX: `getDeviceId` is a terrible API as it might return
                // an empty string instead of null. We replace it with null.
                let deviceId: string | null = await cryptoStore.getDeviceId() || null;

                // If we got an explicit device provided as parameter, use that
                if (providedDeviceId) {
                  if (deviceId && deviceId !== providedDeviceId) {
                      LogService.warn("Intent", `Storage already configured with an existing device ${deviceId}. Old storage will be cleared.`);
                  }
                  deviceId = providedDeviceId;
                }

                // If we don't have a device, look at existing devices that
                // *don't* yet have keys uploaded and try to adopt one
                if (!deviceId) {
                  const ownDevices = await this.client.getOwnDevices();
                  const deviceKeys = await this.client.getUserDevices([this.userId]);
                  const userDeviceKeys = deviceKeys.device_keys[this.userId];
                  if (userDeviceKeys) {
                      // We really should be validating signatures here, but we're actively looking
                      // for devices without keys to impersonate, so it should be fine. In theory,
                      // those devices won't even be present but we're cautious.
                      const devicesWithKeys = Array.from(Object.entries(userDeviceKeys))
                          .filter(d => d[0] === d[1].device_id && !!d[1].keys?.[`${DeviceKeyAlgorithm.Curve25519}:${d[1].device_id}`])
                          .map(t => t[0]); // grab device ID from tuple
                      deviceId = ownDevices.find(d => !devicesWithKeys.includes(d.device_id))?.device_id;
                  }
                }

                // If we still don't have a device ID, generate a random one
                if (!deviceId) {
                  deviceId = randomUUID();
                }

                try {
                  // Make sure the device is registered. Before Matrix C-S 1.17, this would fail if the device doesn't exist.
                  // After 1.17 (or if `io.element.msc4190` is set in the registration file for Synapse 1.121+), it creates the device on the fly
                  await this.client.doRequest("PUT", `/_matrix/client/v3/devices/${deviceId}`, null, {});
                } catch {
                  deviceId = null;
                }

                if (deviceId) {
                    // Check that we can impersonate the device ID
                    this.client.impersonateUserId(this.userId, deviceId);
                    const respDeviceId = (await this.client.getWhoAmI()).device_id;
                    if (respDeviceId !== deviceId) {
                      deviceId = null;
                    }
                }

                // Last resort if we don't have a device ID: have a per-user
                // access token, and do an appservice login if that fails
                let accessToken: string | undefined;
                if (!deviceId) {
                    // Check if we have an existing access token and test it
                    accessToken = await storage?.readValue("accessToken") || undefined;
                    if (accessToken) {
                        this.makeClient(false, accessToken);
                        try {
                            // Check that we can use the existing token
                            await this.client.getWhoAmI();
                        } catch {
                            accessToken = undefined;
                        }
                    }

                    // If the existing access token was not working or absent,
                    // do an appservice login as a last resort
                    if (!accessToken) {
                        // Reset the MatrixClient
                        this.makeClient(false);
                        const loginBody = {
                            type: "m.login.application_service",
                            identifier: {
                                type: "m.id.user",
                                user: this.userId,
                            },
                        };
                        const res = await this.client.doRequest("POST", "/_matrix/client/v3/login", {}, loginBody);
                        accessToken = res['access_token'];
                        deviceId = res['device_id'];
                        await storage.storeValue("accessToken", this.client.accessToken);
                    }
                }

                this.makeClient(true, accessToken);
                this.client.impersonateUserId(this.userId, deviceId);

                // Now set up crypto
                await this.client.crypto.prepare();

                this.appservice.on("room.event", (roomId, event) => {
                    this.client.crypto.onRoomEvent(roomId, event);
                });
            })();
        }
        return this.cryptoSetupPromise;
    }

    /**
     * Gets the joined rooms for the intent.
     * @returns {Promise<string[]>} Resolves to an array of room IDs where
     * the intent is joined.
     */
    @timedIntentFunctionCall()
    public async getJoinedRooms(): Promise<string[]> {
        await this.ensureRegistered();
        return await this.client.getJoinedRooms();
    }

    /**
     * Leaves the given room.
     * @param {string} roomId The room ID to leave
     * @param {string=} reason Optional reason to be included as the reason for leaving the room.
     * @returns {Promise<any>} Resolves when the room has been left.
     */
    @timedIntentFunctionCall()
    public async leaveRoom(roomId: string, reason?: string): Promise<any> {
        await this.ensureRegistered();
        return this.client.leaveRoom(roomId, reason);
    }

    /**
     * Joins the given room
     * @param {string} roomIdOrAlias the room ID or alias to join
     * @returns {Promise<string>} resolves to the joined room ID
     */
    @timedIntentFunctionCall()
    public async joinRoom(roomIdOrAlias: string): Promise<string> {
        await this.ensureRegistered();
        return this.client.joinRoom(roomIdOrAlias);
    }

    /**
     * Sends a text message to a room.
     * @param {string} roomId The room ID to send text to.
     * @param {string} body The message body to send.
     * @param {"m.text" | "m.emote" | "m.notice"} msgtype The message type to send.
     * @returns {Promise<string>} Resolves to the event ID of the sent message.
     */
    @timedIntentFunctionCall()
    public async sendText(roomId: string, body: string, msgtype: "m.text" | "m.emote" | "m.notice" = "m.text"): Promise<string> {
        return this.sendEvent(roomId, { body: body, msgtype: msgtype });
    }

    /**
     * Sends an event to a room.
     * @param {string} roomId The room ID to send the event to.
     * @param {any} content The content of the event.
     * @returns {Promise<string>} Resolves to the event ID of the sent event.
     */
    @timedIntentFunctionCall()
    public async sendEvent(roomId: string, content: any): Promise<string> {
        await this.ensureRegisteredAndJoined(roomId);
        return this.client.sendMessage(roomId, content);
    }

    /**
     * Ensures the user is registered and joined to the given room.
     * @param {string} roomId The room ID to join
     * @returns {Promise<any>} Resolves when complete
     */
    @timedIntentFunctionCall()
    public async ensureRegisteredAndJoined(roomId: string) {
        await this.ensureRegistered();
        await this.ensureJoined(roomId);
    }

    /**
     * Ensures the user is joined to the given room
     * @param {string} roomId The room ID to join
     * @returns {Promise<any>} Resolves when complete
     * @deprecated Use `joinRoom()` instead
     */
    @timedIntentFunctionCall()
    public async ensureJoined(roomId: string) {
        const returnedRoomId = await this.client.joinRoom(roomId);
        return returnedRoomId;
    }

    /**
     * Refreshes which rooms the user is joined to, potentially saving time on
     * calls like ensureJoined()
     * @deprecated There is no longer a joined rooms cache, use `getJoinedRooms()` instead
     * @returns {Promise<string[]>} Resolves to the joined room IDs for the user.
     */
    @timedIntentFunctionCall()
    public async refreshJoinedRooms(): Promise<string[]> {
        return await this.getJoinedRooms();
    }

    /**
     * Ensures the user is registered
     * @param deviceId An optional device ID to register with.
     * @returns {Promise<any>} Resolves when complete
     */
    @timedIntentFunctionCall()
    public async ensureRegistered(deviceId?: string) {
        if (!(await Promise.resolve(this.storage.isUserRegistered(this.userId)))) {
            try {
                const result = await this.client.doRequest("POST", "/_matrix/client/v3/register", null, {
                    type: "m.login.application_service",
                    username: this.userId.substring(1).split(":")[0],
                    device_id: deviceId,
                    inhibit_login: true,
                });

                // HACK: Workaround for unit tests
                if (result['errcode']) {
                    // noinspection ExceptionCaughtLocallyJS
                    throw { body: result }; // eslint-disable-line no-throw-literal
                }

                this.client.impersonateUserId(this.userId, result["device_id"]);
            } catch (err) {
                if (err instanceof MatrixError && err.errcode === "M_USER_IN_USE") {
                    await Promise.resolve(this.storage.addRegisteredUser(this.userId));
                    if (this.userId === this.appservice.botUserId) {
                        return null;
                    } else {
                        LogService.error("Appservice", "Error registering user: User ID is in use");
                        return null;
                    }
                } else {
                    LogService.error("Appservice", "Encountered error registering user: ");
                    LogService.error("Appservice", extractRequestError(err));
                }
                throw err;
            }

            await Promise.resolve(this.storage.addRegisteredUser(this.userId));
        }
    }
}
