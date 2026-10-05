import "dotenv/config";
import { Store } from "./store";
import { Ingestion } from "./ingestion";
const store = new Store(process.env.DATABASE_PATH || "data/zirimiri.sqlite");
await new Ingestion(store).run();
console.log(JSON.stringify(store.status(), null, 2));
if (store.get("errors", 0)) process.exitCode = 1;
store.db.close();
