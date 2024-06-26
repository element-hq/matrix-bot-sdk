import { ICryptoStorageProvider } from "./ICryptoStorageProvider";
import { IStorageProvider } from "./IStorageProvider";

/**
 * A storage provider definition for appservices to use.
 * @category Storage providers
 */
export interface IAppserviceStorageProvider {
    /**
     * Tracks a user ID as "registered".
     * @returns {Promise<any>|void} Resolves when complete.
     */
    addRegisteredUser(userId: string): Promise<any> | void;

    /**
     * Determines if a user ID is registered or not.
     * @returns {boolean|Promise<boolean>} True if registered. This may be a promise.
     */
    isUserRegistered(userId: string): boolean | Promise<boolean>;

    /**
     * Flags a transaction as completed.
     * @param {string} transactionId The transaction ID.
     * @returns {Promise<any>|void} Resolves when complete.
     */
    setTransactionCompleted(transactionId: string): Promise<any> | void;

    /**
     * Determines if a transaction has been flagged as completed.
     * @param {string} transactionId The transaction ID to check.
     * @returns {boolean} True if the transaction has been completed. This may be a promise.
     */
    isTransactionCompleted(transactionId: string): boolean | Promise<boolean>;

    /**
     * Gets a storage provider to use for the given user ID.
     * @param {string} userId The user ID.
     * @returns {ICryptoStorageProvider} The storage provider.
     */
    storageForUser?(userId: string): IStorageProvider;
}

/**
 * A storage provider capable of only providing crypto-related storage to appservices.
 * @category Storage providers
 */
export interface IAppserviceCryptoStorageProvider {
    /**
     * Gets a storage provider to use for the given user ID.
     * @param userId The user ID.
     * @returns The storage provider.
     */
    storageForUser(userId: string): ICryptoStorageProvider;
}
