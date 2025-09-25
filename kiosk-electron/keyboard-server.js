const express = require("express");
const path = require("path");
const app = express();
const PORT = 4000;
app.use(express.static(path.join(__dirname, "keyboard")));
app.listen(PORT, () => console.log(`Keyboard server running on http://localhost:${PORT}`));
