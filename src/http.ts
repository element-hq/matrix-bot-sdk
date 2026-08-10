import * as querystring from "querystring";

import type Dispatcher from "undici/types/dispatcher";
import type { OutgoingHttpHeaders } from "undici/types/header";
import { LogLevel, LogService } from "./logging/LogService";
import { getRequestFn } from "./request";
import { MatrixError } from "./models/MatrixError";

let lastRequestId = 0;

const defaultErrorHandler = (response: Dispatcher.ResponseData, errBody: any) => {
    return typeof (errBody) === "object" && 'errcode' in errBody ?
        new MatrixError(errBody, response.statusCode, response.headers) : undefined;
};

export interface DoHttpRequestOpts {
    errorHandler?: (response: Dispatcher.ResponseData, body: any) => Error|undefined;
}

export type ResponseBody<NoEncoding extends boolean> = NoEncoding extends true ? Buffer : any;
export type RawResponse<NoEncoding extends boolean> = Omit<Dispatcher.ResponseData, "body"> & { body: ResponseBody<NoEncoding> };

/**
 * Performs a web request to a server.
 * @category Unit testing
 * @param baseUrl The base URL to apply to the call.
 * @param method The HTTP method to use in the request
 * @param endpoint The endpoint to call. For example: "/_matrix/client/v3/account/whoami"
 * @param qs The query string to send. Optional.
 * @param body The request body to send. Optional. Will be converted to JSON unless the type is a Buffer.
 * @param headers Additional headers to send in the request.
 * @param timeout The number of milliseconds to wait before timing out.
 * @param raw If true, the raw response will be returned instead of the response body.
 * @param contentType The content type to send. Only used if the `body` is a Buffer.
 * @param noEncoding Set to true to disable encoding, and return a Buffer. Defaults to false
 * @returns Resolves to the response (body), rejected if a non-2xx status code was returned.
 */
export async function doHttpRequest<IsRaw extends boolean = false, NoEncoding extends boolean = false>(
    baseUrl: string,
    method: "GET" | "POST" | "PUT" | "DELETE",
    endpoint: string,
    qs: querystring.ParsedUrlQueryInput | null = null,
    body: any | null = null,
    headers: OutgoingHttpHeaders = {},
    timeout = 60000,
    raw?: IsRaw,
    contentType = "application/json",
    noEncoding?: NoEncoding,
    opts: DoHttpRequestOpts = {
        errorHandler: defaultErrorHandler,
    },
): Promise<IsRaw extends true ? RawResponse<NoEncoding> : ResponseBody<NoEncoding>> {
    if (!endpoint.startsWith('/')) {
        endpoint = '/' + endpoint;
    }

    const requestId = ++lastRequestId;
    const url = new URL(baseUrl + endpoint);
    if (qs) {
        url.search = querystring.stringify(qs);
    }

    // This is logged at info so that when a request fails people can figure out which one.
    LogService.debug("MatrixHttpClient", "(REQ-" + requestId + ")", method + " " + url);

    // Don't log the request unless we're in debug mode. It can be large.
    if (LogService.level.includes(LogLevel.TRACE)) {
        if (qs) LogService.trace("MatrixHttpClient", "(REQ-" + requestId + ")", "qs = " + JSON.stringify(qs));
        if (body && !Buffer.isBuffer(body)) LogService.trace("MatrixHttpClient", "(REQ-" + requestId + ")", "body = " + JSON.stringify(redactObjectForLogging(body)));
        if (body && Buffer.isBuffer(body)) LogService.trace("MatrixHttpClient", "(REQ-" + requestId + ")", "body = <Buffer>");
    }

    if (body) {
        if (Buffer.isBuffer(body)) {
            headers["Content-Type"] = contentType;
        } else {
            headers["Content-Type"] = "application/json";
            body = JSON.stringify(body);
        }
    }

    const response = await getRequestFn()(url, {
        method,
        headersTimeout: timeout,
        bodyTimeout: timeout,
        headers,
        body,
    }).catch((e) => {
        LogService.error("MatrixHttpClient", "(REQ-" + requestId + ")", e);
        throw e;
    });

    let resBody: ResponseBody<NoEncoding> = Buffer.from(await response.body.bytes());
    if (!noEncoding) {
        resBody = resBody.toString();
        try {
            resBody = JSON.parse(resBody);
        } catch {}
    }

    // Check for errors.
    const handledError = opts.errorHandler(response, resBody);
    if (handledError) {
        const redactedBody = noEncoding ? '<Buffer>' : redactObjectForLogging(resBody);
        LogService.error("MatrixHttpClient", "(REQ-" + requestId + ")", redactedBody);
        throw handledError;
    }

    // Don't log the body unless we're in debug mode. They can be large.
    if (LogService.level.includes(LogLevel.TRACE)) {
        const redactedBody = noEncoding ? '<Buffer>' : redactObjectForLogging(resBody);
        LogService.trace("MatrixHttpClient", "(REQ-" + requestId + " RESP-H" + response.statusCode + ")", redactedBody);
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
        const redactedBody = noEncoding ? '<Buffer>' : redactObjectForLogging(resBody);
        LogService.error("MatrixHttpClient", "(REQ-" + requestId + ")", redactedBody);
        throw response;
    }
    return raw ? { ...response, body: resBody } as any : resBody;
}

export function redactObjectForLogging(input: any): any {
    if (!input) return input;

    const fieldsToRedact = [
        'access_token',
        'password',
        'new_password',
    ];

    const redactFn = (i) => {
        if (!i) return i;

        // Don't treat strings like arrays/objects
        if (typeof i === 'string') return i;

        if (Array.isArray(i)) {
            const rebuilt = [];
            for (const v of i) {
                rebuilt.push(redactFn(v));
            }
            return rebuilt;
        }

        if (i instanceof Object) {
            const rebuilt = {};
            for (const key of Object.keys(i)) {
                if (fieldsToRedact.includes(key)) {
                    rebuilt[key] = '<redacted>';
                } else {
                    rebuilt[key] = redactFn(i[key]);
                }
            }
            return rebuilt;
        }

        return i; // It's a primitive value
    };

    return redactFn(input);
}
