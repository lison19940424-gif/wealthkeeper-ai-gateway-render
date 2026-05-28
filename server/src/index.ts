import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { wealthkeeperRouter } from "./routes/wealthkeeper.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "WealthKeeper AI Gateway",
    provider: "deepseek",
    version: "1.3.1"
  });
});

app.use("/api/wealthkeeper", wealthkeeperRouter);

app.listen(port, "0.0.0.0", () => {
  console.log(`WealthKeeper AI Gateway running on port ${port}`);
});
