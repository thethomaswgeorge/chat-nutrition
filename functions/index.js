const { onRequest } = require("firebase-functions/v2/https");
const dotenv = require("dotenv");
const admin = require("firebase-admin");
const { OpenAI } = require("openai");
const { v4: uuidv4 } = require("uuid");
dotenv.config();

admin.initializeApp();
const db = admin.firestore();
const bucket = admin.storage().bucket();

if (process.env.FUNCTIONS_EMULATOR === "true") {
  process.env.GCLOUD_PROJECT = "testproject-422c5";
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function applyDailyGoalUpdate(uid, totals) {
  const today = new Date().toISOString().split("T")[0]; // 'YYYY-MM-DD'
  const goalRef = db
    .collection("users")
    .doc(uid)
    .collection("dailyGoals")
    .doc(today);
  const doc = await goalRef.get();

  // 1️⃣ Create random goal if not exists
  if (!doc.exists) {
    const randomGoal = {
      calories: 1800 + Math.floor(Math.random() * 500),
      carbs: 180 + Math.floor(Math.random() * 40),
      protein: 120 + Math.floor(Math.random() * 40),
      fiber: 25 + Math.floor(Math.random() * 10),
      fat: 60 + Math.floor(Math.random() * 20),
    };

    await goalRef.set({
      goal: randomGoal,
      remaining: { ...randomGoal },
      timestamp: new Date(),
      source: "random",
    });
  }

  // 2️⃣ Subtract totals from remaining
  const current = (await goalRef.get()).data();
  const updatedRemaining = {
    calories: Math.max(current.remaining.calories - totals.calories, 0),
    carbs: Math.max(current.remaining.carbs - totals.carbs, 0),
    protein: Math.max(current.remaining.protein - totals.protein, 0),
    fiber: Math.max(current.remaining.fiber - totals.fiber, 0),
    fat: Math.max(current.remaining.fat - totals.fat, 0),
  };

  await goalRef.update({ remaining: updatedRemaining });

  return {
    goal: current.goal,
    remaining: updatedRemaining,
  };
}

exports.trackFood = onRequest(async (req, res) => {
  const { text, uid } = req.body;

  const prompt = `
Extract the following details from the user's input:
- Food items
- Quantity
- Estimated calories
- Carbohydrates (grams)
- Protein (grams)
- Fiber (grams)
- Fat (grams)

Only respond with valid JSON in this format:
{
  "items": [
    {
      "name": "scrambled eggs",
      "quantity": 2,
      "calories": 140,
      "carbs": 1,
      "protein": 12,
      "fiber": 0,
      "fat": 10
    },
    ...
  ],
  "totals": {
    "calories": 0,
    "carbs": 0,
    "protein": 0,
    "fiber": 0,
    "fat": 0
  }
}

Input: "${text}"
`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [{ role: "user", content: prompt }],
    });

    let parsed = null;
    try {
      parsed = JSON.parse(completion.choices[0].message.content);
    } catch (e) {
      console.error(
        "Failed to parse GPT response:",
        completion.choices[0].message.content
      );
      return res.status(400).send({
        message:
          "The image could not be processed into nutrition data. Please try again with a clearer image.",
      });
    }

    await db
      .collection("users")
      .doc(uid)
      .collection("foodLogs")
      .add({
        input: text,
        ...parsed,
        timestamp: new Date(),
        source: "openai",
      });

    const itemsText = parsed.items
      .map(
        (i) =>
          `${i.quantity} ${i.name} - ${i.calories} cal, ${i.carbs}g carbs, ${i.protein}g protein, ${i.fiber}g fiber, ${i.fat}g fat`
      )
      .join("; ");

    const totals = parsed.totals;
    const message = `Tracked: ${itemsText}. Total — ${totals.calories} cal, ${totals.carbs}g carbs, ${totals.protein}g protein, ${totals.fiber}g fiber, ${totals.fat}g fat.`;

    const updatedGoal = await applyDailyGoalUpdate(uid, parsed.totals);

    res.status(200).send({ message, items: parsed.items, goal: updatedGoal });
  } catch (err) {
    console.error("OpenAI error:", err);
    res.status(500).send({ message: err });
  }
});
exports.trackFoodImage = onRequest(async (req, res) => {
  try {
    const { uid, image } = req.body;
    if (!uid || !image)
      return res.status(400).send({ message: "Missing uid or image data" });

    const matches = image.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches)
      return res.status(400).send({ message: "Invalid image format" });

    const ext = matches[1];
    const buffer = Buffer.from(matches[2], "base64");
    const filename = `chat-images/${uid}_${Date.now()}.${ext}`;
    const file = bucket.file(filename);
    const uuid = uuidv4();

    await file.save(buffer, {
      metadata: {
        contentType: `image/${ext}`,
        metadata: { firebaseStorageDownloadTokens: uuid },
      },
    });

    const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${
      bucket.name
    }/o/${encodeURIComponent(filename)}?alt=media&token=${uuid}`;

    // Vision API request
    const visionPrompt = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Describe the food in this image and estimate the following:
- Food items
- Quantity
- Estimated calories
- Carbohydrates (grams)
- Protein (grams)
- Fiber (grams)
- Fat (grams)

Only respond with valid JSON in this format:
{
  "items": [
    {
      "name": "scrambled eggs",
      "quantity": 2,
      "calories": 140,
      "carbs": 1,
      "protein": 12,
      "fiber": 0,
      "fat": 10
    }
  ],
  "totals": {
    "calories": 0,
    "carbs": 0,
    "protein": 0,
    "fiber": 0,
    "fat": 0
  }
}`,     
          },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ];

    const visionRes = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: visionPrompt,
      max_tokens: 500,
    });

    let parsed = null;
    try {
      parsed = JSON.parse(visionRes.choices[0].message.content);
    } catch (e) {
      console.error(
        "Failed to parse GPT response:",
        visionRes.choices[0].message.content
      );
      return res.status(400).send({
        message:
          "The image could not be processed into nutrition data. Please try again with a clearer image.",
      });
    }

    const itemsText = parsed.items
      .map(
        (i) =>
          `${i.quantity} ${i.name} - ${i.calories} cal, ${i.carbs}g carbs, ${i.protein}g protein, ${i.fiber}g fiber, ${i.fat}g fat`
      )
      .join("; ");

    const totals = parsed.totals;
    const summaryText = `Tracked: ${itemsText}. Total — ${totals.calories} cal, ${totals.carbs}g carbs, ${totals.protein}g protein, ${totals.fiber}g fiber, ${totals.fat}g fat.`;

    await db
      .collection("users")
      .doc(uid)
      .collection("foodLogs")
      .add({
        input: "[Image]",
        ...parsed,
        imageUrl,
        timestamp: new Date(),
        source: "openai-vision",
      });
    const updatedGoal = await applyDailyGoalUpdate(uid, parsed.totals);
    return res.status(200).send({
      message: summaryText,
      items: parsed.items,
      nutrition: parsed.totals,
      goal: updatedGoal,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).send({ message: "Failed to process image." });
  }
});
