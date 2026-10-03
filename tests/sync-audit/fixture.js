import { createStudent } from "../../src/domain/index.js";

export { createEncryptedSyncServer, twoDevices } from "../../src/test/encryptedSyncServer.js";

export function student(id, code = id) {
  return createStudent({ id, code, fullName: `Student ${id}`, isIndividual: true });
}
