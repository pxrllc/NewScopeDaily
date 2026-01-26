require('dotenv').config();

async function checkKey() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        console.log("No key found");
        return;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
    try {
        const res = await fetch(url);
        console.log(`Status: ${res.status} ${res.statusText}`);
        const data = await res.json();
        if (res.ok) {
            console.log("Key is valid. Available models:");
            data.models.forEach(m => console.log(` - ${m.name}`));
        } else {
            console.log("Error body:", JSON.stringify(data, null, 2));
        }
    } catch (e) {
        console.log("Fetch error:", e.message);
    }
}

checkKey();
