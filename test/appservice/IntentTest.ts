import * as simple from "simple-mock";
import * as tmp from "tmp";
import { StoreType } from "@matrix-org/matrix-sdk-crypto-nodejs";

import {
    Appservice,
    IAppserviceCryptoStorageProvider,
    IAppserviceOptions,
    IAppserviceStorageProvider,
    IJoinRoomStrategy,
    Intent,
    MemoryStorageProvider,
    RustSdkAppserviceCryptoStorageProvider,
    setRequestFn,
} from "../../src";
import { HttpBackend } from '../TestUtils';

tmp.setGracefulCleanup();

describe('Intent', () => {
    it('should prepare the underlying client for a bot user', async () => {
        const userId = "@someone:example.org";
        const asToken = "s3cret";
        const hsUrl = "https://localhost";
        const appservice = <Appservice>{ botUserId: userId };
        const options = <IAppserviceOptions>{
            homeserverUrl: hsUrl,
            registration: {
                as_token: asToken,
            },
        };

        const intent = new Intent(options, userId, appservice);
        expect(intent.userId).toEqual(userId);
        expect(intent.underlyingClient).toBeDefined();
        expect((<any>intent.underlyingClient).impersonatedUserId).toBeUndefined();
        expect((<any>intent.underlyingClient).accessToken).toEqual(asToken);
        expect((<any>intent.underlyingClient).homeserverUrl).toEqual(hsUrl);
    });

    it('should prepare the underlying client for a bot user with a join strategy', async () => {
        const userId = "@someone:example.org";
        const asToken = "s3cret";
        const hsUrl = "https://localhost";
        const appservice = <Appservice>{ botUserId: userId };
        const joinStrategy = <IJoinRoomStrategy>{};
        const options = <IAppserviceOptions>{
            homeserverUrl: hsUrl,
            joinStrategy: joinStrategy,
            registration: {
                as_token: asToken,
            },
        };

        const intent = new Intent(options, userId, appservice);
        expect(intent.userId).toEqual(userId);
        expect(intent.underlyingClient).toBeDefined();
        expect((<any>intent.underlyingClient).impersonatedUserId).toBeUndefined();
        expect((<any>intent.underlyingClient).accessToken).toEqual(asToken);
        expect((<any>intent.underlyingClient).homeserverUrl).toEqual(hsUrl);
        expect((<any>intent.underlyingClient).joinStrategy).toEqual(joinStrategy);
    });

    it('should prepare the underlying client for an impersonated user', async () => {
        const userId = "@someone:example.org";
        const botUserId = "@bot:example.org";
        const asToken = "s3cret";
        const hsUrl = "https://localhost";
        const appservice = <Appservice>{ botUserId: botUserId };
        const options = <IAppserviceOptions>{
            homeserverUrl: hsUrl,
            registration: {
                as_token: asToken,
            },
        };

        const intent = new Intent(options, userId, appservice);
        expect(intent.userId).toEqual(userId);
        expect(intent.underlyingClient).toBeDefined();
        expect((<any>intent.underlyingClient).impersonatedUserId).toEqual(userId);
        expect((<any>intent.underlyingClient).accessToken).toEqual(asToken);
        expect((<any>intent.underlyingClient).homeserverUrl).toEqual(hsUrl);
    });

    it('should prepare the underlying client for an impersonated user with a join strategy', async () => {
        const userId = "@someone:example.org";
        const botUserId = "@bot:example.org";
        const asToken = "s3cret";
        const hsUrl = "https://localhost";
        const appservice = <Appservice>{ botUserId: botUserId };
        const joinStrategy = <IJoinRoomStrategy>{};
        const options = <IAppserviceOptions>{
            homeserverUrl: hsUrl,
            joinStrategy: joinStrategy,
            registration: {
                as_token: asToken,
            },
        };

        const intent = new Intent(options, userId, appservice);
        expect(intent.userId).toEqual(userId);
        expect(intent.underlyingClient).toBeDefined();
        expect((<any>intent.underlyingClient).impersonatedUserId).toEqual(userId);
        expect((<any>intent.underlyingClient).accessToken).toEqual(asToken);
        expect((<any>intent.underlyingClient).homeserverUrl).toEqual(hsUrl);
        expect((<any>intent.underlyingClient).joinStrategy).toEqual(joinStrategy);
    });

    describe('ensureRegistered', () => {
        it('should do nothing if the user is flagged as registered', async () => {
            const userId = "@someone:example.org";
            const botUserId = "@bot:example.org";
            const asToken = "s3cret";
            const hsUrl = "https://localhost";
            const appservice = <Appservice>{ botUserId: botUserId };

            const storage = new MemoryStorageProvider();
            const isRegisteredSpy = simple.mock(storage, "isUserRegistered").callFn((uid) => {
                expect(uid).toEqual(userId);
                return true;
            });
            const addRegisteredSpy = simple.mock(storage, "addRegisteredUser").callFn((uid) => {
                expect(uid).toEqual(userId);
                return true;
            });

            const options = <IAppserviceOptions>{
                homeserverUrl: hsUrl,
                storage: <IAppserviceStorageProvider>storage,
                registration: {
                    as_token: asToken,
                },
            };

            const intent = new Intent(options, userId, appservice);
            await intent.ensureRegistered();
            expect(isRegisteredSpy.callCount).toBe(1);
            expect(addRegisteredSpy.callCount).toBe(0);
        });

        it('should try to register the user when not flagged as such', async () => {
            const hsUrl = "https://localhost";
            const http = new HttpBackend(hsUrl);
            http.mockAgent.enableNetConnect();

            const userId = "@someone:example.org";
            const botUserId = "@bot:example.org";
            const asToken = "s3cret";
            const appservice = <Appservice>{ botUserId: botUserId };

            const storage = new MemoryStorageProvider();
            const isRegisteredSpy = simple.mock(storage, "isUserRegistered").callFn((uid) => {
                expect(uid).toEqual(userId);
                return false;
            });
            const addRegisteredSpy = simple.mock(storage, "addRegisteredUser").callFn((uid) => {
                expect(uid).toEqual(userId);
                return true;
            });

            const options = <IAppserviceOptions>{
                homeserverUrl: hsUrl,
                storage: <IAppserviceStorageProvider>storage,
                registration: {
                    as_token: asToken,
                },
            };

            http.mock.intercept({
                method: "POST",
                path: "/_matrix/client/v3/register",
                query: { user_id: userId },
            }).reply(200, (opts) => {
                expect(JSON.parse(opts.body as string)).toMatchObject({ type: "m.login.application_service", username: "someone" });
                return {};
            });

            const intent = new Intent(options, userId, appservice);
            await Promise.all([intent.ensureRegistered(), http.flushAllExpected()]);
            expect(isRegisteredSpy.callCount).toBe(1);
            expect(addRegisteredSpy.callCount).toBe(1);
        });

        it('should use the provided device ID', async () => {
            const hsUrl = "https://localhost";
            const http = new HttpBackend(hsUrl);
            http.mockAgent.enableNetConnect();

            const userId = "@someone:example.org";
            const botUserId = "@bot:example.org";
            const asToken = "s3cret";
            const deviceId = "DEVICE_TEST";
            const appservice = <Appservice>{ botUserId: botUserId };

            const storage = new MemoryStorageProvider();
            const isRegisteredSpy = simple.mock(storage, "isUserRegistered").callFn((uid) => {
                expect(uid).toEqual(userId);
                return false;
            });
            const addRegisteredSpy = simple.mock(storage, "addRegisteredUser").callFn((uid) => {
                expect(uid).toEqual(userId);
                return true;
            });

            const options = <IAppserviceOptions>{
                homeserverUrl: hsUrl,
                storage: <IAppserviceStorageProvider>storage,
                registration: {
                    as_token: asToken,
                },
            };

            http.mock.intercept({
                method: "POST",
                path: "/_matrix/client/v3/register",
                query: { user_id: userId },
            }).reply(200, (opts) => {
                expect(JSON.parse(opts.body as string)).toMatchObject({ type: "m.login.application_service", username: "someone", device_id: deviceId });
                return { device_id: deviceId };
            });

            const intent = new Intent(options, userId, appservice);
            await Promise.all([intent.ensureRegistered(deviceId), http.flushAllExpected()]); // ensureRegistered(deviceId)
            expect(isRegisteredSpy.callCount).toBe(1);
            expect(addRegisteredSpy.callCount).toBe(1);

            http.mock.intercept({
                method: "GET",
                path: "/test",
                query: { user_id: userId, "device_id": deviceId, "org.matrix.msc3202.device_id": deviceId },
            }).reply(200);

            await Promise.all([intent.underlyingClient.doRequest("GET", "/test"), http.flushAllExpected()]);
        });

        it('should impersonate the returned device ID on register', async () => {
            const hsUrl = "https://localhost";
            const http = new HttpBackend(hsUrl);
            http.mockAgent.enableNetConnect();

            const userId = "@someone:example.org";
            const botUserId = "@bot:example.org";
            const asToken = "s3cret";
            const deviceId = "DEVICE_TEST";
            const appservice = <Appservice>{ botUserId: botUserId };

            const storage = new MemoryStorageProvider();
            const isRegisteredSpy = simple.mock(storage, "isUserRegistered").callFn((uid) => {
                expect(uid).toEqual(userId);
                return false;
            });
            const addRegisteredSpy = simple.mock(storage, "addRegisteredUser").callFn((uid) => {
                expect(uid).toEqual(userId);
                return true;
            });

            const options = <IAppserviceOptions>{
                homeserverUrl: hsUrl,
                storage: <IAppserviceStorageProvider>storage,
                registration: {
                    as_token: asToken,
                },
            };

            http.mock.intercept({
                method: "POST",
                path: "/_matrix/client/v3/register",
                query: { user_id: userId },
            }).reply(200, (opts) => {
                expect(JSON.parse(opts.body as string)).toMatchObject({ type: "m.login.application_service", username: "someone" });
                return { device_id: deviceId };
            });

            const intent = new Intent(options, userId, appservice);
            await Promise.all([intent.ensureRegistered(), http.flushAllExpected()]);
            expect(isRegisteredSpy.callCount).toBe(1);
            expect(addRegisteredSpy.callCount).toBe(1);

            http.mock.intercept({
                method: "GET",
                path: "/test",
                query: { user_id: userId, "device_id": deviceId, "org.matrix.msc3202.device_id": deviceId },
            }).reply(200);

            await Promise.all([intent.underlyingClient.doRequest("GET", "/test"), http.flushAllExpected()]);
        });

        it('should gracefully handle M_USER_IN_USE', async () => {
            const hsUrl = "https://localhost";
            const http = new HttpBackend(hsUrl);
            http.mockAgent.enableNetConnect();

            const userId = "@someone:example.org";
            const botUserId = "@bot:example.org";
            const asToken = "s3cret";
            const appservice = <Appservice>{ botUserId: botUserId };

            const storage = new MemoryStorageProvider();
            const isRegisteredSpy = simple.mock(storage, "isUserRegistered").callFn((uid) => {
                expect(uid).toEqual(userId);
                return false;
            });
            const addRegisteredSpy = simple.mock(storage, "addRegisteredUser").callFn((uid) => {
                expect(uid).toEqual(userId);
                return true;
            });

            const options = <IAppserviceOptions>{
                homeserverUrl: hsUrl,
                storage: <IAppserviceStorageProvider>storage,
                registration: {
                    as_token: asToken,
                },
            };

            // HACK: 200 OK because the mock lib can't handle 400+response body
            http.mock.intercept({
                method: "POST",
                path: "/_matrix/client/v3/register",
                query: { user_id: userId },
            }).reply(200, (opts) => {
                expect(JSON.parse(opts.body as string)).toMatchObject({ type: "m.login.application_service", username: "someone" });
                return { errcode: "M_USER_IN_USE", error: "User ID already in use" };
            });

            const intent = new Intent(options, userId, appservice);
            await Promise.all([intent.ensureRegistered(), http.flushAllExpected()]);
            expect(isRegisteredSpy.callCount).toBe(1);
            expect(addRegisteredSpy.callCount).toBe(1);
        });

        it('should handle unexpected errors', async () => {
            const hsUrl = "https://localhost";
            const http = new HttpBackend(hsUrl);
            http.mockAgent.enableNetConnect();

            const userId = "@someone:example.org";
            const botUserId = "@bot:example.org";
            const asToken = "s3cret";
            const appservice = <Appservice>{ botUserId: botUserId };

            const storage = new MemoryStorageProvider();
            const isRegisteredSpy = simple.mock(storage, "isUserRegistered").callFn((uid) => {
                expect(uid).toEqual(userId);
                return false;
            });
            const addRegisteredSpy = simple.mock(storage, "addRegisteredUser").callFn((uid) => {
                expect(uid).toEqual(userId);
                return true;
            });

            const options = <IAppserviceOptions>{
                homeserverUrl: hsUrl,
                storage: <IAppserviceStorageProvider>storage,
                registration: {
                    as_token: asToken,
                },
            };

            http.mock.intercept({
                method: "POST",
                path: "/_matrix/client/v3/register",
                query: { user_id: userId },
            }).reply(500, (opts) => {
                expect(JSON.parse(opts.body as string)).toMatchObject({ type: "m.login.application_service", username: "someone" });
                return { errcode: "M_UNKNOWN", error: "It broke" };
            });

            const flush = http.flushAllExpected();
            const intent = new Intent(options, userId, appservice);
            try {
                await intent.ensureRegistered();

                // noinspection ExceptionCaughtLocallyJS
                throw new Error("Request completed when it should have failed");
            } catch (e) {
                expect(e.statusCode).toBe(500);
            }
            expect(isRegisteredSpy.callCount).toBe(1);
            expect(addRegisteredSpy.callCount).toBe(0);

            await flush;
        });
    });

    describe('ensureJoined', () => {
        it('should attempt to join rooms a user is not in', async () => {
            const userId = "@someone:example.org";
            const botUserId = "@bot:example.org";
            const asToken = "s3cret";
            const hsUrl = "https://localhost";
            const targetRoomId = "!c:example.org";
            const appservice = <Appservice>{ botUserId: botUserId };
            const storage = new MemoryStorageProvider();
            const options = <IAppserviceOptions>{
                homeserverUrl: hsUrl,
                storage: <IAppserviceStorageProvider>storage,
                registration: {
                    as_token: asToken,
                },
            };

            const intent = new Intent(options, userId, appservice);

            const joinSpy = simple.stub().callFn((rid) => {
                expect(rid).toEqual(targetRoomId);
                return Promise.resolve("!joined:example.org");
            });
            intent.underlyingClient.joinRoom = joinSpy;

            await intent.ensureJoined(targetRoomId);
            expect(joinSpy.callCount).toBe(1);
        });

        it('should proxy failure for joining a room', async () => {
            const userId = "@someone:example.org";
            const botUserId = "@bot:example.org";
            const asToken = "s3cret";
            const hsUrl = "https://localhost";
            const targetRoomId = "!c:example.org";
            const appservice = <Appservice>{ botUserId: botUserId };
            const storage = new MemoryStorageProvider();
            const options = <IAppserviceOptions>{
                homeserverUrl: hsUrl,
                storage: <IAppserviceStorageProvider>storage,
                registration: {
                    as_token: asToken,
                },
            };

            const intent = new Intent(options, userId, appservice);

            const joinSpy = simple.stub().callFn((rid) => {
                expect(rid).toEqual(targetRoomId);
                throw new Error("Simulated failure");
            });
            intent.underlyingClient.joinRoom = joinSpy;

            try {
                await intent.ensureJoined(targetRoomId);

                // noinspection ExceptionCaughtLocallyJS
                throw new Error("Request completed when it should have failed");
            } catch (e) {
                expect(e.message).toEqual("Simulated failure");
            }
            expect(joinSpy.callCount).toBe(1);
        });
    });

    describe('ensureRegisteredAndJoined', () => {
        it('should call both ensureRegistered and ensureJoined', async () => {
            const userId = "@someone:example.org";
            const botUserId = "@bot:example.org";
            const asToken = "s3cret";
            const hsUrl = "https://localhost";
            const appservice = <Appservice>{ botUserId: botUserId };
            const targetRoomId = "!a:example.org";
            const storage = new MemoryStorageProvider();
            const options = <IAppserviceOptions>{
                homeserverUrl: hsUrl,
                storage: <IAppserviceStorageProvider>storage,
                registration: {
                    as_token: asToken,
                },
            };

            const intent = new Intent(options, userId, appservice);

            const registeredSpy = simple.mock(intent, "ensureRegistered").callFn(() => {
                return Promise.resolve();
            });
            const joinSpy = simple.mock(intent, "ensureJoined").callFn((rid) => {
                expect(rid).toEqual(targetRoomId);
                return {};
            });

            await intent.ensureRegisteredAndJoined(targetRoomId);
            expect(registeredSpy.callCount).toBe(1);
            expect(joinSpy.callCount).toBe(1);
        });

        it('should proxy failure from ensureRegistered', async () => {
            const userId = "@someone:example.org";
            const botUserId = "@bot:example.org";
            const asToken = "s3cret";
            const hsUrl = "https://localhost";
            const appservice = <Appservice>{ botUserId: botUserId };
            const targetRoomId = "!a:example.org";
            const storage = new MemoryStorageProvider();
            const options = <IAppserviceOptions>{
                homeserverUrl: hsUrl,
                storage: <IAppserviceStorageProvider>storage,
                registration: {
                    as_token: asToken,
                },
            };

            const intent = new Intent(options, userId, appservice);

            const registeredSpy = simple.mock(intent, "ensureRegistered").callFn(() => {
                throw new Error("Simulated failure");
            });
            const joinSpy = simple.mock(intent, "ensureJoined").callFn((rid) => {
                expect(rid).toEqual(targetRoomId);
                return {};
            });

            try {
                await intent.ensureRegisteredAndJoined(targetRoomId);

                // noinspection ExceptionCaughtLocallyJS
                throw new Error("Request completed when it should have failed");
            } catch (e) {
                expect(e.message).toEqual("Simulated failure");
            }
            expect(registeredSpy.callCount).toBe(1);
            expect(joinSpy.callCount).toBe(0);
        });

        it('should proxy failure from ensureJoined', async () => {
            const userId = "@someone:example.org";
            const botUserId = "@bot:example.org";
            const asToken = "s3cret";
            const hsUrl = "https://localhost";
            const appservice = <Appservice>{ botUserId: botUserId };
            const targetRoomId = "!a:example.org";
            const storage = new MemoryStorageProvider();
            const options = <IAppserviceOptions>{
                homeserverUrl: hsUrl,
                storage: <IAppserviceStorageProvider>storage,
                registration: {
                    as_token: asToken,
                },
            };

            const intent = new Intent(options, userId, appservice);

            const registeredSpy = simple.mock(intent, "ensureRegistered").callFn(() => {
                return Promise.resolve();
            });
            const joinSpy = simple.mock(intent, "ensureJoined").callFn((rid) => {
                expect(rid).toEqual(targetRoomId);
                throw new Error("Simulated failure");
            });

            try {
                await intent.ensureRegisteredAndJoined(targetRoomId);

                // noinspection ExceptionCaughtLocallyJS
                throw new Error("Request completed when it should have failed");
            } catch (e) {
                expect(e.message).toEqual("Simulated failure");
            }
            expect(registeredSpy.callCount).toBe(1);
            expect(joinSpy.callCount).toBe(1);
        });
    });

    describe('sendEvent', () => {
        it('should proxy through to the client while ensuring they are registered and joined', async () => {
            const userId = "@someone:example.org";
            const botUserId = "@bot:example.org";
            const asToken = "s3cret";
            const hsUrl = "https://localhost";
            const appservice = <Appservice>{ botUserId: botUserId };
            const targetRoomId = "!a:example.org";
            const content = { hello: "world" };
            const eventId = "$something:example.org";
            const storage = new MemoryStorageProvider();
            const options = <IAppserviceOptions>{
                homeserverUrl: hsUrl,
                storage: <IAppserviceStorageProvider>storage,
                registration: {
                    as_token: asToken,
                },
            };

            const intent = new Intent(options, userId, appservice);

            const registeredSpy = simple.mock(intent, "ensureRegistered").callFn(() => {
                return Promise.resolve();
            });
            const joinSpy = simple.mock(intent, "ensureJoined").callFn((rid) => {
                expect(rid).toEqual(targetRoomId);
                return {};
            });

            const eventSpy = simple.stub().callFn((rid, c) => {
                expect(rid).toEqual(targetRoomId);
                expect(c).toMatchObject(content);
                return Promise.resolve(eventId);
            });
            intent.underlyingClient.sendMessage = eventSpy;

            const result = await intent.sendEvent(targetRoomId, content);
            expect(result).toEqual(eventId);
            expect(eventSpy.callCount).toBe(1);
            expect(registeredSpy.callCount).toBe(1);
            expect(joinSpy.callCount).toBe(1);
        });

        it('should proxy errors upwards', async () => {
            const userId = "@someone:example.org";
            const botUserId = "@bot:example.org";
            const asToken = "s3cret";
            const hsUrl = "https://localhost";
            const appservice = <Appservice>{ botUserId: botUserId };
            const targetRoomId = "!a:example.org";
            const content = { hello: "world" };
            const storage = new MemoryStorageProvider();
            const options = <IAppserviceOptions>{
                homeserverUrl: hsUrl,
                storage: <IAppserviceStorageProvider>storage,
                registration: {
                    as_token: asToken,
                },
            };

            const intent = new Intent(options, userId, appservice);

            const registeredSpy = simple.mock(intent, "ensureRegistered").callFn(() => {
                return Promise.resolve();
            });
            const joinSpy = simple.mock(intent, "ensureJoined").callFn((rid) => {
                expect(rid).toEqual(targetRoomId);
                return {};
            });

            const eventSpy = simple.stub().callFn((rid, c) => {
                expect(rid).toEqual(targetRoomId);
                expect(c).toMatchObject(content);
                throw new Error("Simulated failure");
            });
            intent.underlyingClient.sendMessage = eventSpy;

            try {
                await intent.sendEvent(targetRoomId, content);

                // noinspection ExceptionCaughtLocallyJS
                throw new Error("Request completed when it should have failed");
            } catch (e) {
                expect(e.message).toEqual("Simulated failure");
            }
            expect(eventSpy.callCount).toBe(1);
            expect(registeredSpy.callCount).toBe(1);
            expect(joinSpy.callCount).toBe(1);
        });
    });

    describe('sendText', () => {
        it('should proxy through to the client while ensuring they are registered and joined', async () => {
            const userId = "@someone:example.org";
            const botUserId = "@bot:example.org";
            const asToken = "s3cret";
            const hsUrl = "https://localhost";
            const appservice = <Appservice>{ botUserId: botUserId };
            const targetRoomId = "!a:example.org";
            const content = { body: "hello world", msgtype: "m.emote" };
            const eventId = "$something:example.org";
            const storage = new MemoryStorageProvider();
            const options = <IAppserviceOptions>{
                homeserverUrl: hsUrl,
                storage: <IAppserviceStorageProvider>storage,
                registration: {
                    as_token: asToken,
                },
            };

            const intent = new Intent(options, userId, appservice);

            const registeredSpy = simple.mock(intent, "ensureRegistered").callFn(() => {
                return Promise.resolve();
            });
            const joinSpy = simple.mock(intent, "ensureJoined").callFn((rid) => {
                expect(rid).toEqual(targetRoomId);
                return {};
            });

            const eventSpy = simple.stub().callFn((rid, c) => {
                expect(rid).toEqual(targetRoomId);
                expect(c).toMatchObject(content);
                return Promise.resolve(eventId);
            });
            intent.underlyingClient.sendMessage = eventSpy;

            const result = await intent.sendText(targetRoomId, content.body, <any>content.msgtype);
            expect(result).toEqual(eventId);
            expect(eventSpy.callCount).toBe(1);
            expect(registeredSpy.callCount).toBe(1);
            expect(joinSpy.callCount).toBe(1);
        });

        it('should proxy errors upwards', async () => {
            const userId = "@someone:example.org";
            const botUserId = "@bot:example.org";
            const asToken = "s3cret";
            const hsUrl = "https://localhost";
            const appservice = <Appservice>{ botUserId: botUserId };
            const targetRoomId = "!a:example.org";
            const content = { body: "hello world", msgtype: "m.emote" };
            const storage = new MemoryStorageProvider();
            const options = <IAppserviceOptions>{
                homeserverUrl: hsUrl,
                storage: <IAppserviceStorageProvider>storage,
                registration: {
                    as_token: asToken,
                },
            };

            const intent = new Intent(options, userId, appservice);

            const registeredSpy = simple.mock(intent, "ensureRegistered").callFn(() => {
                return Promise.resolve();
            });
            const joinSpy = simple.mock(intent, "ensureJoined").callFn((rid) => {
                expect(rid).toEqual(targetRoomId);
                return {};
            });

            const eventSpy = simple.stub().callFn((rid, c) => {
                expect(rid).toEqual(targetRoomId);
                expect(c).toMatchObject(content);
                throw new Error("Simulated failure");
            });
            intent.underlyingClient.sendMessage = eventSpy;

            try {
                await intent.sendText(targetRoomId, content.body, <any>content.msgtype);

                // noinspection ExceptionCaughtLocallyJS
                throw new Error("Request completed when it should have failed");
            } catch (e) {
                expect(e.message).toEqual("Simulated failure");
            }
            expect(eventSpy.callCount).toBe(1);
            expect(registeredSpy.callCount).toBe(1);
            expect(joinSpy.callCount).toBe(1);
        });
    });

    describe('joinRoom', () => {
        it('should proxy through to the client while ensuring they are registered', async () => {
            const userId = "@someone:example.org";
            const botUserId = "@bot:example.org";
            const asToken = "s3cret";
            const hsUrl = "https://localhost";
            const appservice = <Appservice>{ botUserId: botUserId };
            const targetRoomId = "!a:example.org";
            const storage = new MemoryStorageProvider();
            const options = <IAppserviceOptions>{
                homeserverUrl: hsUrl,
                storage: <IAppserviceStorageProvider>storage,
                registration: {
                    as_token: asToken,
                },
            };

            const intent = new Intent(options, userId, appservice);

            const registeredSpy = simple.mock(intent, "ensureRegistered").callFn(() => {
                return Promise.resolve();
            });
            const joinSpy = simple.mock(intent, "ensureJoined").callFn((rid) => {
                expect(rid).toEqual(targetRoomId);
                return {};
            });
            const joinRoomSpy = simple.stub().callFn((rid) => {
                expect(rid).toEqual(targetRoomId);
                return Promise.resolve(targetRoomId);
            });
            intent.underlyingClient.joinRoom = joinRoomSpy;

            const result = await intent.joinRoom(targetRoomId);
            expect(result).toEqual(targetRoomId);
            expect(joinRoomSpy.callCount).toBe(1);
            expect(registeredSpy.callCount).toBe(1);
            expect(joinSpy.callCount).toBe(0);
        });

        it('should proxy errors upwards', async () => {
            const userId = "@someone:example.org";
            const botUserId = "@bot:example.org";
            const asToken = "s3cret";
            const hsUrl = "https://localhost";
            const appservice = <Appservice>{ botUserId: botUserId };
            const targetRoomId = "!a:example.org";
            const storage = new MemoryStorageProvider();
            const options = <IAppserviceOptions>{
                homeserverUrl: hsUrl,
                storage: <IAppserviceStorageProvider>storage,
                registration: {
                    as_token: asToken,
                },
            };

            const intent = new Intent(options, userId, appservice);

            const registeredSpy = simple.mock(intent, "ensureRegistered").callFn(() => {
                return Promise.resolve();
            });
            const joinSpy = simple.mock(intent, "ensureJoined").callFn((rid) => {
                expect(rid).toEqual(targetRoomId);
                return {};
            });

            const joinRoomSpy = simple.stub().callFn((rid) => {
                expect(rid).toEqual(targetRoomId);
                throw new Error("Simulated failure");
            });
            intent.underlyingClient.joinRoom = joinRoomSpy;

            try {
                await intent.joinRoom(targetRoomId);

                // noinspection ExceptionCaughtLocallyJS
                throw new Error("Request completed when it should have failed");
            } catch (e) {
                expect(e.message).toEqual("Simulated failure");
            }
            expect(joinRoomSpy.callCount).toBe(1);
            expect(registeredSpy.callCount).toBe(1);
            expect(joinSpy.callCount).toBe(0);
        });
    });

    describe('leaveRoom', () => {
        it('should proxy through to the client while ensuring they are registered', async () => {
            const userId = "@someone:example.org";
            const botUserId = "@bot:example.org";
            const asToken = "s3cret";
            const hsUrl = "https://localhost";
            const appservice = <Appservice>{ botUserId: botUserId };
            const targetRoomId = "!a:example.org";
            const storage = new MemoryStorageProvider();
            const options = <IAppserviceOptions>{
                homeserverUrl: hsUrl,
                storage: <IAppserviceStorageProvider>storage,
                registration: {
                    as_token: asToken,
                },
            };

            const intent = new Intent(options, userId, appservice);

            const registeredSpy = simple.mock(intent, "ensureRegistered").callFn(() => {
                return Promise.resolve();
            });
            const joinSpy = simple.mock(intent, "ensureJoined").callFn((rid) => {
                expect(rid).toEqual(targetRoomId);
                return {};
            });

            const leaveRoomSpy = simple.stub().callFn((rid) => {
                expect(rid).toEqual(targetRoomId);
                return Promise.resolve(targetRoomId);
            });
            intent.underlyingClient.leaveRoom = leaveRoomSpy;

            await intent.leaveRoom(targetRoomId);
            expect(leaveRoomSpy.callCount).toBe(1);
            expect(registeredSpy.callCount).toBe(1);
            expect(joinSpy.callCount).toBe(0);
        });

        it('should proxy errors upwards', async () => {
            const userId = "@someone:example.org";
            const botUserId = "@bot:example.org";
            const asToken = "s3cret";
            const hsUrl = "https://localhost";
            const appservice = <Appservice>{ botUserId: botUserId };
            const targetRoomId = "!a:example.org";
            const storage = new MemoryStorageProvider();
            const options = <IAppserviceOptions>{
                homeserverUrl: hsUrl,
                storage: <IAppserviceStorageProvider>storage,
                registration: {
                    as_token: asToken,
                },
            };

            const intent = new Intent(options, userId, appservice);

            const registeredSpy = simple.mock(intent, "ensureRegistered").callFn(() => {
                return Promise.resolve();
            });
            const joinSpy = simple.mock(intent, "ensureJoined").callFn((rid) => {
                expect(rid).toEqual(targetRoomId);
                return {};
            });

            const leaveRoomSpy = simple.stub().callFn((rid) => {
                expect(rid).toEqual(targetRoomId);
                throw new Error("Simulated failure");
            });
            intent.underlyingClient.leaveRoom = leaveRoomSpy;

            try {
                await intent.leaveRoom(targetRoomId);

                // noinspection ExceptionCaughtLocallyJS
                throw new Error("Request completed when it should have failed");
            } catch (e) {
                expect(e.message).toEqual("Simulated failure");
            }
            expect(leaveRoomSpy.callCount).toBe(1);
            expect(registeredSpy.callCount).toBe(1);
            expect(joinSpy.callCount).toBe(0);
        });
    });

    describe('ensureToDeviceReady', () => {
        const userId = "@bot:example.org";
        const appservice = <Appservice>{ botUserId: userId };

        function createIntent(opts: {
            token?: string;
            senderLocalpart?: string;
            registrationId?: string;
            autoEncryption?: boolean;
            cryptoStorage?: IAppserviceCryptoStorageProvider;
        } = {}): Intent {
            const intentOptions: IAppserviceOptions = {
                homeserverName: "example.org",
                homeserverUrl: "https://localhost",
                storage: new MemoryStorageProvider(),
                intentOptions: { encryption: opts.autoEncryption ?? false },
                registration: {
                    as_token: opts.token ?? "as-token",
                    hs_token: "hs-token",
                    sender_localpart: opts.senderLocalpart ?? "bot",
                    namespaces: { users: [], aliases: [], rooms: [] },
                    url: null,
                    ...(opts.registrationId ? { id: opts.registrationId } : {}),
                },
                cryptoStorage: opts.cryptoStorage,
                port: 9000,
                bindAddress: "127.0.0.1",
            };
            const intent = new Intent(intentOptions, userId, appservice);
            intent.ensureRegistered = jest.fn().mockResolvedValue(undefined);
            return intent;
        }

        function stubUnkeyedClient(intent: Intent, devices: string[] = []) {
            const client = (intent as any).client;
            client.createDevice = jest.fn().mockResolvedValue(undefined);
            client.getOwnDevices = jest.fn().mockResolvedValue(devices.map(deviceId => ({ device_id: deviceId })));
            return client;
        }

        function stubCryptoClient(
            intent: Intent,
            deviceId = "persisted-device",
            whoamiDeviceId = deviceId,
            devices: string[] = [deviceId],
            setupPromise: Promise<void> = Promise.resolve(),
        ) {
            const cryptoClient = {
                crypto: { clientDeviceId: deviceId },
                getWhoAmI: jest.fn().mockResolvedValue({ user_id: userId, device_id: whoamiDeviceId }),
                getOwnDevices: jest.fn().mockResolvedValue(devices.map(deviceId => ({ device_id: deviceId }))),
            };
            (intent as any).client = cryptoClient;
            (intent as any).cryptoSetupPromise = setupPromise;
            intent.enableEncryption = jest.fn().mockReturnValue(setupPromise);
            return cryptoClient;
        }

        it('should use the stable unkeyed device ID when encryption is not enabled', async () => {
            const cryptoStorage = <IAppserviceCryptoStorageProvider>{ storageForUser: jest.fn() };
            const intent = createIntent({ cryptoStorage });
            const client = stubUnkeyedClient(intent, ["BOTSDK_TODEVICE_V1_be62ef9b166c6db228375c5f48e9748d"]);
            const enableEncryptionSpy = jest.spyOn(intent, "enableEncryption");

            const deviceId = await intent.ensureToDeviceReady();

            expect(deviceId).toEqual("BOTSDK_TODEVICE_V1_be62ef9b166c6db228375c5f48e9748d");
            expect(client.createDevice).toHaveBeenCalledWith(deviceId);
            expect(intent.ensureRegistered).toHaveBeenCalled();
            expect(enableEncryptionSpy).not.toHaveBeenCalled();
        });

        it('should reuse the unkeyed ID across restarts and access token changes', async () => {
            const prepareIntent = (token: string, senderLocalpart = "bot") => {
                const intent = createIntent({ token, senderLocalpart });
                const deviceId = senderLocalpart === "bot"
                    ? "BOTSDK_TODEVICE_V1_be62ef9b166c6db228375c5f48e9748d"
                    : "BOTSDK_TODEVICE_V1_f25ae3e2b40ef7b2ae597e59bce0405e";
                stubUnkeyedClient(intent, [deviceId]);
                return intent;
            };

            const first = await prepareIntent("first-token").ensureToDeviceReady();
            const restarted = await prepareIntent("rotated-token").ensureToDeviceReady();
            const changedIdentity = await prepareIntent("rotated-token", "other").ensureToDeviceReady();

            expect(first).toEqual("BOTSDK_TODEVICE_V1_be62ef9b166c6db228375c5f48e9748d");
            expect(restarted).toEqual(first);
            expect(changedIdentity).not.toEqual(first);
        });

        it('should use and verify the persisted crypto device when encryption is configured', async () => {
            const cryptoStorage = <IAppserviceCryptoStorageProvider>{ storageForUser: jest.fn() };
            const intent = createIntent({ autoEncryption: true, cryptoStorage });
            const cryptoClient = stubCryptoClient(intent);

            await expect(intent.ensureToDeviceReady()).resolves.toEqual("persisted-device");

            expect(intent.enableEncryption).toHaveBeenCalled();
            expect(cryptoClient.getWhoAmI).toHaveBeenCalled();
            expect(cryptoClient.getOwnDevices).toHaveBeenCalled();
        });

        it('should await a manually started in-flight crypto setup', async () => {
            let finishSetup!: () => void;
            const setupPromise = new Promise<void>(resolve => finishSetup = resolve);
            const intent = createIntent();
            stubCryptoClient(intent, "persisted-device", "persisted-device", ["persisted-device"], setupPromise);

            let readinessFinished = false;
            const readiness = intent.ensureToDeviceReady().then(deviceId => {
                readinessFinished = true;
                return deviceId;
            });
            await Promise.resolve();
            expect(readinessFinished).toBe(false);

            finishSetup();
            await expect(readiness).resolves.toEqual("persisted-device");
        });

        it('should propagate a rejected crypto setup without creating an unkeyed device', async () => {
            const intent = createIntent();
            const client = stubUnkeyedClient(intent);
            const setupPromise = Promise.reject(new Error("crypto setup failed"));
            (intent as any).cryptoSetupPromise = setupPromise;
            intent.enableEncryption = jest.fn().mockReturnValue(setupPromise);

            await expect(intent.ensureToDeviceReady()).rejects.toThrow("crypto setup failed");
            expect(client.createDevice).not.toHaveBeenCalled();
        });

        it.each([
            ["missing from the device list", "persisted-device", []],
            ["has a mismatched whoami device", "other-device", ["persisted-device"]],
        ])('should fail when the crypto device is %s', async (_description, whoamiDeviceId, devices) => {
            const intent = createIntent({ autoEncryption: true });
            stubCryptoClient(intent, "persisted-device", whoamiDeviceId, devices);

            await expect(intent.ensureToDeviceReady()).rejects.toThrow("is not active on the intent");
        });

        it('should stay on the unkeyed client if crypto setup starts during readiness', async () => {
            const intent = createIntent();
            const client = stubUnkeyedClient(intent);
            const deviceId = "BOTSDK_TODEVICE_V1_be62ef9b166c6db228375c5f48e9748d";
            let finishCreation!: () => void;
            let signalCreationStarted!: () => void;
            const creation = new Promise<void>(resolve => finishCreation = resolve);
            const creationStarted = new Promise<void>(resolve => signalCreationStarted = resolve);
            client.createDevice = jest.fn(() => {
                signalCreationStarted();
                return creation;
            });
            client.getOwnDevices = jest.fn().mockResolvedValue([{ device_id: deviceId }]);
            const cryptoClient = {
                crypto: { clientDeviceId: "crypto-device" },
                getWhoAmI: jest.fn().mockResolvedValue({ device_id: "crypto-device" }),
                getOwnDevices: jest.fn().mockResolvedValue([{ device_id: "crypto-device" }]),
            };
            intent.enableEncryption = jest.fn().mockImplementation(async () => {
                (intent as any).cryptoSetupPromise = Promise.resolve();
                (intent as any).client = cryptoClient;
            });

            const readiness = intent.ensureToDeviceReady();
            await creationStarted;
            await intent.enableEncryption();
            finishCreation();

            await expect(readiness).resolves.toEqual(deviceId);
            expect(client.getOwnDevices).toHaveBeenCalled();
            expect(cryptoClient.getOwnDevices).not.toHaveBeenCalled();
        });
    });

    describe('enableEncryption', () => {
        const userId = "@someone:example.org";
        const botUserId = "@bot:example.org";
        const asToken = "s3cret";
        const hsUrl = "https://localhost";
        const appservice = <Appservice>{ botUserId: botUserId };
        let storage: IAppserviceStorageProvider;
        let cryptoStorage: IAppserviceCryptoStorageProvider;
        let options: IAppserviceOptions;
        let intent: Intent;  

        beforeEach(() => {
            storage = new MemoryStorageProvider();
            cryptoStorage = new RustSdkAppserviceCryptoStorageProvider(tmp.dirSync().name, StoreType.Sqlite);
            options = {
                homeserverUrl: hsUrl,
                storage: storage,
                cryptoStorage: cryptoStorage,
                intentOptions: {
                    encryption: true,
                },
                port: 9000,
                bindAddress: "127.0.0.1",
                homeserverName: "example.org",
                registration: {
                    id: asToken,
                    as_token: asToken,
                    hs_token: asToken,
                    sender_localpart: "bot",
                    namespaces: {
                        users: [],
                        aliases: [],
                        rooms: [],
                    },
                    url: null,
                },
            };
            intent = new Intent(options, userId, appservice);
        });

        it('should continue through the existing fallback when createDevice fails', async () => {
            const userStorage = {
                readValue: jest.fn().mockResolvedValue("saved-token"),
                storeValue: jest.fn(),
            };
            (intent as any).storage = { storageForUser: jest.fn().mockReturnValue(userStorage) };
            (intent as any).cryptoStorage = {
                storageForUser: jest.fn().mockReturnValue({ getDeviceId: jest.fn().mockResolvedValue(null) }),
            };
            intent.ensureRegistered = jest.fn().mockResolvedValue(undefined);

            const initialClient = intent.underlyingClient as any;
            initialClient.getOwnDevices = jest.fn().mockResolvedValue([]);
            initialClient.getUserDevices = jest.fn().mockResolvedValue({ device_keys: {} });
            initialClient.createDevice = jest.fn().mockRejectedValue(new Error("device creation failed"));

            const fallbackClient = {
                getWhoAmI: jest.fn().mockResolvedValue({ user_id: userId }),
            };
            const cryptoClient = {
                impersonateUserId: jest.fn(),
                crypto: { prepare: jest.fn().mockResolvedValue(undefined) },
            };
            const makeClientSpy = jest.spyOn(intent as any, "makeClient").mockImplementation((...args: unknown[]) => {
                const withCrypto = args[0] === true;
                (intent as any).client = withCrypto ? cryptoClient : fallbackClient;
            });
            (appservice as any).on = jest.fn();

            await expect(intent.enableEncryption()).resolves.toBeUndefined();

            expect(initialClient.createDevice).toHaveBeenCalled();
            expect(makeClientSpy).toHaveBeenNthCalledWith(1, false, "saved-token");
            expect(makeClientSpy).toHaveBeenNthCalledWith(2, true, "saved-token");
            expect(cryptoClient.crypto.prepare).toHaveBeenCalled();
        });

        // TODO: Test once device_id impersonation set up

        it.skip('should only set up crypto once', async () => {

        });

        it.skip('should set up crypto', async () => {

        });

        it.skip('should impersonate device IDs when known', async () => {

        });

        it.skip('should use the same device ID when known', async () => {

        });

        it.skip('should log in to get a device ID if none are viable', async () => {

        });
    });
});
