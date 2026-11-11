import { runJobs } from "../src/lib/jobs";
runJobs().then((r) => { console.log(r); process.exit(0); });
