import express from "express";

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    app: "Whisky Club API"
  });
});

app.listen(port, () => {
  console.log(`Whisky Club API running on port ${port}`);
});