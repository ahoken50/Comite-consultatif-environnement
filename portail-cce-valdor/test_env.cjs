const fs = require('fs');
const dotenv = require('dotenv');

if (fs.existsSync('.env.local')) {
    const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
    console.log("Found .env.local");
    console.log("SUPABASE_URL =", envConfig.VITE_SUPABASE_URL !== undefined ? "Set" : "Not set");
} else {
    console.log("No .env.local found");
}

if (fs.existsSync('.env')) {
    const envConfig = dotenv.parse(fs.readFileSync('.env'));
    console.log("Found .env");
    console.log("VITE_SUPABASE_URL =", envConfig.VITE_SUPABASE_URL !== undefined ? "Set" : "Not set");
} else {
    console.log("No .env found");
}
