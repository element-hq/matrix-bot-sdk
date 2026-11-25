import type { Dispatcher } from "undici";
import { doHttpRequest, setRequestFn } from "../src";

describe('http', () => {
    describe('Unix domain socket URLs', () => {
        let mockFn: jest.Mock;

        beforeEach(() => {
            mockFn = jest.fn().mockResolvedValue({ body: { bytes: () => new Uint8Array() } });
            setRequestFn(mockFn);
        });

        async function testHttpRequest(url: string, endpoint: string): Promise<void> {
            await doHttpRequest(url, "GET", endpoint);
        }

        describe('should support', () => {
            const socketPath = "/path/to/socket.sock";

            afterEach(() => {
                expectSocketPath();
            });

            it.each([
                // authorities
                ["empty", ""],
                ["host", "home.local"],
                ["host:port", "home.test:1234"],
            ].flatMap(([authorityKind, authority]) => [
                // base paths
                ["empty", ""],
                ["non-empty", "/base/path"],
                ["trailing whitespace", "/base/path  "],
            ].flatMap(([basePathKind, basePath]) => [
                // endpoints
                ["empty", ""],
                ["non-empty", "_matrix/static/"],
            ].map(([endpointKind, endpoint]) => [authorityKind, basePathKind, endpointKind, authority, basePath, endpoint]))
            ))('%s authority & %s base path, with %s endpoint', async (_authorityKind, _basePathKind, _endpointKind, authority, basePath, endpoint) => {
                await testHttpRequest(`http://unix:${socketPath}:${authority}${basePath}`, endpoint);
                expectHttpUrl(`http://${authority || "localhost"}${basePath}/${endpoint}`);
            });

            it("no trailing colon for empty authority, base path, and endpoint", async () => {
                await testHttpRequest(`http://unix:${socketPath}`, "");
                expectHttpUrl("http://localhost/");
            });

            it.each([
                ["HTTPS", "https"],
                ["non-HTTP (to be validated by the requestFn)", "ftp"],
                ["HTTP with leading whitespace (allowed by the URL API)", "  http"],
            ])("scheme of %s", async (_schemeKind, scheme) => {
                await testHttpRequest(`${scheme}://unix:${socketPath}`, "");
                expectHttpUrl(`${scheme.trimStart()}://localhost/`);
            });

            function expectHttpUrl(url: string): void {
                expect(mockFn.mock.lastCall[0].toString()).toBe(encodeURI(url));
            }

            // Would rather mock & spy on the constructor for undici.Agent...
            function expectSocketPath(): void {
                const { dispatcher } = mockFn.mock.lastCall[1]!;
                expect(dispatcher).toBeDefined();
                const key = Object.getOwnPropertySymbols(dispatcher).find((s) => s.description === "options")!;
                expect(key).toBeDefined();
                expect(dispatcher[key]).toMatchObject({ connect: { socketPath }});
            }
        });

        describe('should reject', () => {
            it.each([
                ["leading-dot", "./path/to/socket.sock"],
                ["bare", "socket.sock"],
            ])('relative socket path with %s', async (_kind, socketPath) => {
                await expect(testHttpRequest(`http://unix:${socketPath}:/`, "")).rejects.toThrow();
            });
        });
    });
});
