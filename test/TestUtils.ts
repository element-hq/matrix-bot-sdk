import * as tmp from "tmp";
import { StoreType } from "@matrix-org/matrix-sdk-crypto-nodejs";
import { Interceptable, MockAgent, request, setGlobalDispatcher } from "undici";

import { IStorageProvider, MatrixClient, OTKAlgorithm, RustSdkCryptoStorageProvider, ServerVersions, UnpaddedBase64, setRequestFn } from "../src";

export const TEST_DEVICE_ID = "TEST_DEVICE";

export function expectArrayEquals(expected: any[], actual: any[]) {
    expect(expected).toBeDefined();
    expect(actual).toBeDefined();
    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < actual.length; i++) {
        expect(actual[i]).toEqual(expected[i]);
    }
}

export type Constructor<T> = { new(...args: any[]): T };

export function expectInstanceOf<T>(expected: Constructor<T>, actual: any): boolean {
    return actual instanceof expected;
}

export function testDelay(ms: number): Promise<any> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

export class HttpBackend {
    public mockAgent: MockAgent;
    public mock: Interceptable;

    public constructor(hsUrl: string) {
        this.mockAgent = new MockAgent();
        this.mockAgent.disableNetConnect();
        this.mock = this.mockAgent.get(hsUrl);
        setGlobalDispatcher(this.mockAgent);
        setRequestFn(request);
    }

    public async flushAllExpected(opts?: { timeout?: number }): Promise<number> {
        let firstCheck = false;
        const endTime = Date.now() + (opts?.timeout ?? 1000);
        do {
            if (this.mockAgent.pendingInterceptors().length === 0) {
                if (firstCheck) {
                    // calling flushAllExpected when there are no pending interceptors is a
                    // silly thing to do, and probably means that your test isn't
                    // doing what you think it is doing (or it is racy). Hence we
                    // reject this, rather than resolving immediately.
                    throw new Error("flushAllExpected called with no pending interceptors");
                }
                return;
            }
            firstCheck = false;
            await new Promise<void>((resolve) => setTimeout(resolve, 5));
        } while (Date.now() < endTime);
        this.mockAgent.assertNoPendingInterceptors();
    }
}

export function createTestClient(
    storage: IStorageProvider = null,
    userId: string = null,
    cryptoStoreType?: StoreType,
    opts?: Partial<{ handleWhoAmI: boolean, precacheVersions: boolean }>,
): {
    client: MatrixClient;
    http: HttpBackend;
    hsUrl: string;
    accessToken: string;
} {
    opts = {
        handleWhoAmI: true,
        precacheVersions: true,
        ...opts,
    };
    const hsUrl = "https://localhost";
    const accessToken = "s3cret";
    const client = new MatrixClient(hsUrl, accessToken, storage, (cryptoStoreType !== undefined) ? new RustSdkCryptoStorageProvider(tmp.dirSync().name, cryptoStoreType) : null);
    (<any>client).userId = userId; // private member access
    const http = new HttpBackend(hsUrl);

    // Force versions
    if (opts.precacheVersions) {
        (<any>client).cachedVersions = {
            unstable_features: { },
            versions: ["v1.11"],
        } as ServerVersions;
        (<any>client).versionsLastFetched = Date.now();
    }

    if (opts.handleWhoAmI) {
        // Ensure we always respond to a whoami
        client.getWhoAmI = () => Promise.resolve({ user_id: userId, device_id: TEST_DEVICE_ID });
    }

    return { http, hsUrl, accessToken, client };
}

const CRYPTO_STORE_TYPES: StoreType[] = [StoreType.Sqlite];

export async function testCryptoStores(fn: (StoreType) => Promise<void>): Promise<void> {
    for (const st of CRYPTO_STORE_TYPES) {
        await fn(st);
    }
}

export function bindNullEngine(http: HttpBackend) {
    http.mock.intercept({
        method: "POST",
        path: "/_matrix/client/v3/keys/upload",
    }).reply(200, (opts) => {
        expect(JSON.parse(opts.body as string)).toMatchObject({});
        return {
            one_time_key_counts: {
                // Enough to trick the OlmMachine into thinking it has enough keys
                [OTKAlgorithm.Signed]: 1000,
            },
        };
    });
    // Some oddity with the rust-sdk bindings during setup
    bindNullQuery(http);
}

export function bindNullQuery(http: HttpBackend) {
    http.mock.intercept({
        method: "POST",
        path: "/_matrix/client/v3/keys/query",
    }).reply(200, {});
}

/**
 * Generate a string that can be used as a curve25519 public key.
 * @returns A 32-byte string comprised of Unpadded Base64 characters.
 */
export function generateCurve25519PublicKey() {
    return UnpaddedBase64.encodeString(generateAZString(32));
}

/**
 * Generate an arbitrary string with characters in the range A-Z.
 * @param length The length of the string to generate.
 * @returns The generated string.
 */
function generateAZString(length: number) {
    return String.fromCharCode(...Array.from({ length }, () => Math.floor(65 + Math.random()*25)));
}
