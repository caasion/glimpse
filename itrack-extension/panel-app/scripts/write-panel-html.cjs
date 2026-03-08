const fs = require("fs");
const path = require("path");

const panelDir = path.join(__dirname, "..", "..", "panel");
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>iTrack Panel</title>
</head>
<body>
  <div id="itrack-react-root"></div>
  <script src="./panel.js"></script>
</body>
</html>
`;

fs.mkdirSync(panelDir, { recursive: true });
fs.writeFileSync(path.join(panelDir, "panel.html"), html, "utf8");
console.log("Wrote panel/panel.html");
