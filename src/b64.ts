/**
 * Encodes Base64.
 * @category Utilities
 * @param b The buffer to encode.
 * @returns The Base64 string.
 */
export function encodeBase64(...params: Parameters<typeof Buffer["from"]>): string {
    return Buffer.from(...params).toString('base64');
}

/**
 * Encodes Unpadded Base64.
 * @category Utilities
 * @param b The buffer to encode.
 * @returns The Base64 string.
 */
export function encodeUnpaddedBase64(...params: Parameters<typeof Buffer["from"]>): string {
    return encodeBase64(...params).replace(/=+/g, '');
}

/**
 * Encodes URL-Safe Unpadded Base64.
 * @category Utilities
 * @param b The buffer to encode.
 * @returns The Base64 string.
 */
export function encodeUnpaddedUrlSafeBase64(...params: Parameters<typeof Buffer["from"]>): string {
    return encodeUnpaddedBase64(...params).replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Decodes Base64.
 * @category Utilities
 * @param {string} s The Base64 string.
 * @returns {Uint8Array} The encoded data as a buffer.
 */
export function decodeBase64(s: string): Uint8Array {
    return Buffer.from(s, 'base64');
}

/**
 * Decodes Unpadded Base64.
 * @category Utilities
 * @param {string} s The Base64 string.
 * @returns {Uint8Array} The encoded data as a buffer.
 */
export function decodeUnpaddedBase64(s: string): Uint8Array {
    return decodeBase64(s); // yay, it's the same
}

/**
 * Decodes URL-Safe Unpadded Base64.
 * @category Utilities
 * @param {string} s The Base64 string.
 * @returns {Uint8Array} The encoded data as a buffer.
 */
export function decodeUnpaddedUrlSafeBase64(s: string): Uint8Array {
    return decodeUnpaddedBase64(s.replace(/-/g, '+').replace(/_/g, '/'));
}
