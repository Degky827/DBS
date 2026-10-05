const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "User Service Running" });
});

app.listen(5002, () => {
  console.log("User Service running on port 5002");
});