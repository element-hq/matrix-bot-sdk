import { AdminApis, IStorageProvider, MatrixClient, WhoisInfo } from "../src";
import { createTestClient, HttpBackend } from "./TestUtils";

export function createTestAdminClient(storage: IStorageProvider = null): { client: AdminApis, mxClient: MatrixClient, http: HttpBackend, hsUrl: string, accessToken: string } {
    const result = createTestClient(storage);
    const mxClient = result.client;
    const client = new AdminApis(mxClient);

    delete result.client;

    return { ...result, client, mxClient };
}

describe('AdminApis', () => {
    describe('whoisUser', () => {
        it('should call the right endpoint', async () => {
            const { client, http, hsUrl } = createTestAdminClient();

            const userId = "@someone:example.org";
            const response: WhoisInfo = {
                user_id: userId,
                devices: {
                    foobar: {
                        sessions: [{
                            connections: [{
                                ip: "127.0.0.1",
                                last_seen: 1000,
                                user_agent: "FakeDevice/1.0.0",
                            }],
                        }],
                    },
                },
            };

            http.mock.intercept({
                method: "GET",
                path: `/_matrix/client/v3/admin/whois/${encodeURIComponent(userId)}`,
            }).reply(200, response);

            const result = client.whoisUser(userId);
            await http.flushAllExpected();
            expect(await result).toMatchObject(<any>response);
        });
    });
});
