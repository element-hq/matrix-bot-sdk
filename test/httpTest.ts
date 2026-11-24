import undici from "undici";

import { doHttpRequest, setRequestFn } from "../src";

describe('http', () => {
    it('should support Unix domain sockets', async () => {
        const mockFn = jest.fn().mockResolvedValue({ body: { bytes: () => new Uint8Array() } });
        setRequestFn(mockFn);

        const socketPath = "/path/to/socket";
        const basePath = "/base/path";
        const endpoint = "/_matrix/static/";
        await doHttpRequest(`http://unix:${socketPath}:${basePath}`, "GET", endpoint);

        expect(mockFn.mock.lastCall[0].toString()).toBe(`http://localhost${basePath}${endpoint}`);

        const { dispatcher } = mockFn.mock.lastCall[1];
        expect(dispatcher).toBeDefined();
        // Would rather mock & spy on the constructor for undici.Agent...
        expect(dispatcher[Object.getOwnPropertySymbols(dispatcher).find((s) => s.description === "options")]).toMatchObject({ connect: { socketPath }});
    });
});
