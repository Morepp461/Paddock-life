import { CapacitorSQLiteDatabase } from "./CapacitorSQLiteDatabase";
import type { IDatabase } from "./IDatabase";
import { runMigrations } from "./Migrations";

/** Opens one SQLite database per save slot/career, as specified in Local Data Storage. */
export async function openCareerDatabase(careerId: string): Promise<IDatabase> {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(careerId)) {
    throw new Error("Career ID tidak valid.");
  }
  const database = await CapacitorSQLiteDatabase.open(`career_${careerId}`);
  try {
    await runMigrations(database);
    return database;
  } catch (error) {
    await database.close();
    throw error;
  }
}
