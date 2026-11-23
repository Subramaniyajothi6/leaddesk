import { createApp } from './app.js'
import { env } from './config/env.js'
import { startJobs } from './jobs/scheduler.js'

const app = createApp()
app.listen(env.PORT, () => console.log(`LeadDesk API on http://localhost:${env.PORT}/api`))
// Small deployments run the jobs in the API process; set RUN_JOBS=0 and run `npm run worker` separately to split them.
if (process.env.RUN_JOBS !== '0') startJobs()
