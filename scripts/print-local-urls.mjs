import os from "os";

const port = Number(process.argv[2] || "5500");

function isPrivateIpv4(ip) {
  return (
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

const networkInterfaces = os.networkInterfaces();
const lanIps = [];

for (const entries of Object.values(networkInterfaces)) {
  for (const entry of entries || []) {
    if (entry.family !== "IPv4" || entry.internal || !isPrivateIpv4(entry.address)) {
      continue;
    }
    lanIps.push(entry.address);
  }
}

if (lanIps.length === 0) {
  console.log(`No LAN IPv4 found. Use http://localhost:${port}`);
  process.exit(0);
}

const uniqueIps = [...new Set(lanIps)];

console.log("Local auth/mobile URLs:");
console.log(`- http://localhost:${port}`);
for (const ip of uniqueIps) {
  console.log(`- http://${ip}:${port}`);
}
