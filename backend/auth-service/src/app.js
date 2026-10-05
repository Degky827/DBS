const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Auth Service Running" });
});

app.listen(5001, () => {
  console.log("Auth Service running on port 5001");
});