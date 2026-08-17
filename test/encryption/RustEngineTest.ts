import { EncryptionSettings } from "@matrix-org/matrix-sdk-crypto-nodejs";

import { ICryptoRoomInformation, MembershipEvent, RoomEncryptionAlgorithm } from "../../src";
import { RustEngine } from "../../src/e2ee/RustEngine";

describe('RustEngine', () => {
    describe('prepareEncrypt', () => {
        const roomId = "!a:example.org";
        const userId = "@alice:example.org";

        /**
         * Run {@link RustEngine#prepareEncrypt} against a stubbed machine, and return the
         * {@link EncryptionSettings} it handed to `shareRoomKey`.
         */
        async function getSharedSettings(roomInfo: ICryptoRoomInformation): Promise<EncryptionSettings> {
            let settings: EncryptionSettings;

            const machine = {
                updateTrackedUsers: () => Promise.resolve(),
                outgoingRequests: () => Promise.resolve([]),
                getMissingSessions: () => Promise.resolve(null),
                shareRoomKey: (_roomId, _users, s: EncryptionSettings) => {
                    settings = s;
                    return Promise.resolve([]);
                },
            };

            const client = {
                getRoomMembersByMembership: () => Promise.resolve([new MembershipEvent({
                    type: "m.room.member",
                    sender: userId,
                    state_key: userId,
                    content: { membership: "join" },
                })]),
            };

            await new RustEngine(<any>machine, <any>client).prepareEncrypt(roomId, roomInfo);

            return settings;
        }

        // The rust-sdk expects `rotationPeriod` in microseconds, whereas `m.room.encryption`
        // states it in milliseconds.
        it('should convert the default rotation period to microseconds', async () => {
            const settings = await getSharedSettings({
                algorithm: RoomEncryptionAlgorithm.MegolmV1AesSha2,
            });

            expect(settings.rotationPeriod).toEqual(604800000000n); // 1 week
            expect(settings.rotationPeriodMessages).toEqual(100n);
        });

        it('should convert a supplied rotation period to microseconds', async () => {
            const settings = await getSharedSettings({
                algorithm: RoomEncryptionAlgorithm.MegolmV1AesSha2,
                rotation_period_ms: 86400000,
                rotation_period_msgs: 50,
            });

            expect(settings.rotationPeriod).toEqual(86400000000n); // 1 day
            expect(settings.rotationPeriodMessages).toEqual(50n);
        });
    });
});
