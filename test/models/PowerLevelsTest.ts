import {
    type PowerLevelsEventContent,
    PLManager,
    ROOM_ADMIN_PL,
    ROOM_CREATOR_PL,
} from "../../src";

const PrimaryCreator = "@alice:bar";
const ExtraCreators = ["@bob:bar", "@charlie:bar"];

type TestCandidate = [
    {
        creators: string[];
        canAdjustPL: boolean;
        creatorPL: number;
    },
    { room_version?: string, additional_creators?: string[] },
    PowerLevelsEventContent | undefined,
];

const StateSets: TestCandidate[] = [
    // Without extra creators
    [
        { creators: [PrimaryCreator], canAdjustPL: true, creatorPL: 0 },
        {},
        undefined,
    ],
    [
        { creators: [PrimaryCreator], canAdjustPL: true, creatorPL: 0 },
        { room_version: "1" },
        undefined,
    ],
    [
        {
            creators: [PrimaryCreator],
            canAdjustPL: false,
            creatorPL: ROOM_CREATOR_PL,
        },
        { room_version: "12" },
        undefined,
    ],
    [
        {
            creators: [PrimaryCreator],
            canAdjustPL: false,
            creatorPL: ROOM_CREATOR_PL,
        },
        { room_version: "org.matrix.hydra.11" },
        undefined,
    ],

    // With extra creators
    [
        { creators: [PrimaryCreator], canAdjustPL: true, creatorPL: 0 },
        { additional_creators: ExtraCreators },
        undefined,
    ],
    [
        { creators: [PrimaryCreator], canAdjustPL: true, creatorPL: 0 },
        { room_version: "1", additional_creators: ExtraCreators },
        undefined,
    ],
    [
        {
            creators: [PrimaryCreator, ...ExtraCreators],
            canAdjustPL: false,
            creatorPL: ROOM_CREATOR_PL,
        },
        { room_version: "12", additional_creators: ExtraCreators },
        undefined,
    ],
    [
        {
            creators: [PrimaryCreator, ...ExtraCreators],
            canAdjustPL: false,
            creatorPL: ROOM_CREATOR_PL,
        },
        {
            room_version: "org.matrix.hydra.11",
            additional_creators: ExtraCreators,
        },
        undefined,
    ],

    // With PLs
    [
        {
            creators: [PrimaryCreator],
            canAdjustPL: true,
            creatorPL: ROOM_ADMIN_PL,
        },
        { additional_creators: ExtraCreators },
        { users: { [PrimaryCreator]: ROOM_ADMIN_PL } },
    ],
    [
        {
            creators: [PrimaryCreator],
            canAdjustPL: true,
            creatorPL: ROOM_ADMIN_PL,
        },
        { room_version: "1", additional_creators: ExtraCreators },
        { users: { [PrimaryCreator]: ROOM_ADMIN_PL } },
    ],
    [
        {
            creators: [PrimaryCreator, ...ExtraCreators],
            canAdjustPL: false,
            creatorPL: ROOM_CREATOR_PL,
        },
        { room_version: "12", additional_creators: ExtraCreators },
        { users: { [PrimaryCreator]: ROOM_ADMIN_PL } },
    ],
    [
        {
            creators: [PrimaryCreator, ...ExtraCreators],
            canAdjustPL: false,
            creatorPL: ROOM_CREATOR_PL,
        },
        {
            room_version: "org.matrix.hydra.11",
            additional_creators: ExtraCreators,
        },
        { users: { [PrimaryCreator]: ROOM_ADMIN_PL } },
    ],
];

describe("PLManager", function() {
    it("should throw if the room is missing create state", function() {
        expect(() => PLManager.createFromRoomState([])).toThrow(
            "Could not find create event for room, cannot handle",
        );
    });

    for (const [expected, createEventContent, plContent] of StateSets) {
        const createEvent = {
            type: "m.room.create",
            state_key: "",
            sender: PrimaryCreator,
            content: createEventContent,
            event_id: "$create",
            origin_server_ts: 1,
            room_id: "!unused",
            unsigned: {},
        };
        const powerLevelEvent = plContent && {
            type: "m.room.power_levels",
            state_key: "",
            sender: PrimaryCreator,
            content: plContent as Record<string, unknown>,
            event_id: "$create",
            origin_server_ts: 1,
            room_id: "!unused",
            unsigned: {},
        };

        describe(`with room version ${createEvent.content.room_version} and extra creators=${createEvent.content.additional_creators}`, function() {
            let plManager: PLManager;

            beforeEach(function() {
                plManager = PLManager.createFromRoomState([
                    createEvent,
                    ...(powerLevelEvent ? [powerLevelEvent] : []),
                ]);
            });

            it(`Get correct set of creators with room version`, function() {
                expect(plManager.getFirstCreator).toEqual(PrimaryCreator);
                expect([...plManager.creators]).toEqual(
                    expected.creators,
                );
            });

            it(`Correctly calculates canAdjustUserPL`, function() {
                for (const creator of plManager.creators) {
                    expect(plManager.canAdjustUserPL(creator)).toEqual(
                        expected.canAdjustPL,
                    );
                }
            });

            it(`Correctly calculates getUserPowerLevel`, function() {
                expect(plManager.getUserPowerLevel(PrimaryCreator)).toEqual(
                    expected.creatorPL,
                );
            });
        });
    }
});
