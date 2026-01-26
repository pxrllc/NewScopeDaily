const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

async function listModels() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        // Just try a simple generation to see if it works or if LIST is needed
        // Listing models isn't directly exposed in the high-level SDK easily without looking at docs, 
        // but we can try to generate a simple "hello".

        console.log("Trying gemini-1.5-flash...");
        const result = await model.generateContent("Hello?");
        console.log("Success with gemini-1.5-flash!");
        console.log(result.response.text());
    } catch (e) {
        console.error("Failed 1.5-flash:", e.message);

        try {
            console.log("Trying gemini-pro...");
            const model2 = genAI.getGenerativeModel({ model: "gemini-pro" });
            const result2 = await model2.generateContent("Hello?");
            console.log("Success with gemini-pro!");
        } catch (e2) {
            console.error("Failed gemini-pro:", e2.message);
        }
    }
}

listModels();
