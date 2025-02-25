
type BooleanCapability = { enabled: boolean };

export interface MatrixCapabilities {
    /**
     * Is the user able to add, remove, or change 3PID associations on their account .
     */
    "m.3pid_changes"?: BooleanCapability;
    /**
     * Is the user able to change their own password.
     */
    "m.change_password"?: BooleanCapability;
    /**
     * Is the user able to generate single-use, time-limited tokens via the API.
     */
    "m.get_login_token"?: BooleanCapability;
    /**
     * Is the user able to change their own avatar_url via profile endpoints.
     */
    "m.set_avatar_url"?: BooleanCapability;
    /**
     * Is the user able to change their own display name via profile endpoints.
     */
    "m.set_displayname"?: BooleanCapability;
    /**
     * Describes the default and available room versions a server supports, and at what level of stability.
     *
     * Any room version not marked as "stable" should be considered "unstable"
     */
    "m.room_versions"?: {
        "available": {
            [version: string]: "stable"|string;
        };
        "default": string;
    };
    [key: string]: unknown;
}
