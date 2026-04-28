import {
    type MatrixClient,
    type PowerLevelsEventContent,
    UserID,
} from "..";

const CREATOR_ROOM_VERSIONS = ["12", "org.matrix.hydra.11"];

interface CreateEventContentHydra {
    additional_creators?: string[];
    room_version: "12" | "org.matrix.hydra.11";
}

interface CreateEventContentLegacy {
    /**
     * The room version. "v1" rooms are possibly undefined.
     */
    room_version?: string;
}

// Effective defaults for power levels
// https://spec.matrix.org/v1.15/client-server-api/#mroompower_levels

export const ROOM_MODERATOR_PL = 50;
export const ROOM_ADMIN_PL = 100;

// MAX_INT + 1, so it always trumps any PL in canonical JSON.
export const ROOM_CREATOR_PL = 2 ** 53;

const DEFAULT_PL: PowerLevelsEventContent = {
    ban: ROOM_MODERATOR_PL,
    invite: 0,
    state_default: ROOM_MODERATOR_PL,
    events_default: 0,
};

/**
 * Handles calculating the true power levels for a given room, taking into
 * account any specific room version features.
 */
export class PLManager {
    public static createFromRoomState(
        roomState: Awaited<ReturnType<MatrixClient["getRoomState"]>>,
    ): PLManager {
        const createEvent = roomState.find(
            (s) => s.type === "m.room.create" && s.state_key === "",
        );
        if (!createEvent) {
            throw Error("Could not find create event for room, cannot handle");
        }
        // This is not required to exist.
        const plEvent = roomState.find(
            (s) => s.type === "m.room.power_levels" && s.state_key === "",
        );
        return new PLManager(createEvent, plEvent?.content);
    }

    public readonly creators: Set<string>;

    public static areCreatorsPriviledged(roomVersion: string): boolean {
        return CREATOR_ROOM_VERSIONS.includes(roomVersion);
    }

    public get areCreatorsPriviledged(): boolean {
        return (
            !!this.createEvent.content.room_version &&
            CREATOR_ROOM_VERSIONS.includes(
                this.createEvent.content.room_version,
            )
        );
    }

    public get getFirstCreator(): string {
        // Creator field is never used.
        return this.createEvent.sender;
    }

    public get currentPL(): PowerLevelsEventContent {
        return {
            ...DEFAULT_PL,
            ...this.powerLevels,
        };
    }

    public get defaultPL(): number {
        return this.powerLevels?.users_default ?? 0;
    }

    constructor(
        private readonly createEvent: {
            sender: string;
            content: CreateEventContentHydra | CreateEventContentLegacy;
        },
        private powerLevels: PowerLevelsEventContent | undefined,
    ) {
        this.creators = new Set([new UserID(this.getFirstCreator).toString()]);
        if (
            this.areCreatorsPriviledged &&
            "additional_creators" in createEvent.content
        ) {
            for (const userId of createEvent.content.additional_creators ??
                []) {
                // The server MUST validate these to be valid userIDs.
                this.creators.add(new UserID(userId).toString());
            }
        }
    }

    public canAdjustUserPL(userId: string): boolean {
        if (this.areCreatorsPriviledged) {
            return !this.creators.has(userId);
        }
        return true;
    }

    public getUserPowerLevel(userId: string): number {
        if (this.areCreatorsPriviledged && this.creators.has(userId)) {
            return ROOM_CREATOR_PL;
        }
        return (
            this.powerLevels?.users?.[userId] ??
            this.powerLevels?.users_default ??
            0
        );
    }
}

/**
 * Information on the bounds of a power level change a user can apply.
 */
export interface PowerLevelBounds {
    /**
     * Whether or not the user can even modify the power level of the user. This
     * will be false if the user can't send power level events, or the user is
     * unobtainably high in power.
     */
    canModify: boolean;

    /**
     * The maximum possible power level the user can set on the target user.
     */
    maximumPossibleLevel: number;
}

/**
 * Actions that can be guarded by power levels.
 */
export enum PowerLevelAction {
    /**
     * Power level required to ban other users.
     */
    Ban = "ban",

    /**
     * Power level required to kick other users.
     */
    Kick = "kick",

    /**
     * Power level required to redact events sent by other users. Users can redact
     * their own messages regardless of this power level requirement, unless forbidden
     * by the `events` section of the power levels content.
     */
    RedactEvents = "redact",

    /**
     * Power level required to invite other users.
     */
    Invite = "invite",

    /**
     * Power level required to notify the whole room with "@room".
     */
    NotifyRoom = "notifications.room",
}
