import type { MatrixClient } from "./MatrixClient";

export interface PingHomeserverResponse {
    duration_ms: number;
}

/**
 * APIs for use within the scope of an appservice.
 */
export class AppserviceApis {
    /**
     *
     * @param client A client with the appservice token configured.
     * @param appserviceId The `id` of the appservice, as per its registration file.
     */
    constructor(private readonly client: MatrixClient, private readonly appserviceId?: string) { }

    /**
     * This API asks the homeserver to call the /_matrix/app/v1/ping endpoint on the application service
     * to ensure that the homeserver can communicate with the application service.
     * @param transactionId A unique ID that identifies the ping request.
     */
    public pingHomeserver(transactionId: string): Promise<PingHomeserverResponse> {
        if (!this.appserviceId) {
            throw Error('No `id` given in registration information. Cannot ping homeserver');
        }
        return this.client.doRequest("POST", `/_matrix/client/v1/appservice/${this.appserviceId}/ping`, undefined, { transaction_id: transactionId });
    }
}
