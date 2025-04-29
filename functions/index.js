const { onRequest } = require('firebase-functions/v2/https');
const dotenv = require('dotenv');
const admin = require("firebase-admin");
const { OpenAI } = require("openai");
const { v4: uuidv4 } = require('uuid');
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

exports.importBrandedDrinks = onRequest(async (req, res) => {
  const brandedDrinks = [
    {
      name: "ZestBev Citrus Kick",
      carbs: 25,
      fiber: 2,
      protein: 0,
      fat: 0,
      calories: 100,
    },
    {
      name: "ZestBev Mango Burst",
      carbs: 30,
      fiber: 3,
      protein: 1,
      fat: 0,
      calories: 120,
    },
    {
      name: "ZestBev Berry Blast",
      carbs: 20,
      fiber: 1,
      protein: 0,
      fat: 0,
      calories: 90,
    },
    {
      name: "ZestBev Green Zen",
      carbs: 18,
      fiber: 2,
      protein: 1,
      fat: 1,
      calories: 80,
    },
    {
      name: "ZestBev Watermelon Rush",
      carbs: 28,
      fiber: 2,
      protein: 0,
      fat: 0,
      calories: 110,
    },
    {
      name: "ZestBev Peach Chill",
      carbs: 22,
      fiber: 1,
      protein: 0,
      fat: 0,
      calories: 95,
    },
    {
      name: "ZestBev Tropical Fizz",
      carbs: 26,
      fiber: 2,
      protein: 1,
      fat: 0,
      calories: 105,
    },
  ];

  const batch = db.batch();
  brandedDrinks.forEach((drink) => {
    const ref = db.collection("brandedDrinks").doc();
    batch.set(ref, drink);
  });

  await batch.commit();
  res.send("Branded drinks imported!");
});

exports.trackFood = onRequest(async (req, res) => {
  const { text, uid } = req.body;

  // Get all branded drinks
  const brandedSnapshot = await db.collection("brandedDrinks").get();
  const brandedDrinks = [];
  brandedSnapshot.forEach((doc) => {
    brandedDrinks.push({ id: doc.id, ...doc.data() });
  });

  // Try to find branded drinks mentioned in the user text
  const matchedDrinks = brandedDrinks.filter((drink) =>
    text.toLowerCase().includes(drink.name.toLowerCase())
  );

  if (matchedDrinks.length > 0) {
    const items = matchedDrinks.map((drink) => ({
      name: drink.name,
      quantity: 1,
      calories: drink.calories,
      carbs: drink.carbs,
      protein: drink.protein,
      fiber: drink.fiber,
      fat: drink.fat,
    }));

    const totals = items.reduce(
      (acc, item) => {
        acc.calories += item.calories;
        acc.carbs += item.carbs;
        acc.protein += item.protein;
        acc.fiber += item.fiber;
        acc.fat += item.fat;
        return acc;
      },
      { calories: 0, carbs: 0, protein: 0, fiber: 0, fat: 0 }
    );

    await db.collection("users").doc(uid).collection("foodLogs").add({
      input: text,
      items,
      totals,
      timestamp: new Date(),
      source: "brandedDrinks",
    });

    const summary = items
      .map(
        (i) =>
          `${i.name} - ${i.calories} cal, ${i.carbs}g carbs, ${i.protein}g protein, ${i.fiber}g fiber, ${i.fat}g fat`
      )
      .join("; ");

    return res.status(200).send({
      message: `Tracked from brand database: ${summary}. Total — ${totals.calories} cal, ${totals.carbs}g carbs, ${totals.protein}g protein, ${totals.fiber}g fiber, ${totals.fat}g fat.`,
    });
  }

  const prompt = `
You are a nutritionist. Extract the following details from the user's input:
- Food items
- Quantity
- Estimated calories
- Carbohydrates (grams)
- Protein (grams)
- Fiber (grams)
- Fat (grams)

Return the response in the following JSON format:
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
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
    });

    const json = JSON.parse(completion.choices[0].message.content);

    await db
      .collection("users")
      .doc(uid)
      .collection("foodLogs")
      .add({
        input: text,
        ...json,
        timestamp: new Date(),
        source: "openai",
      });

    const itemsText = json.items
      .map(
        (i) =>
          `${i.quantity} ${i.name} - ${i.calories} cal, ${i.carbs}g carbs, ${i.protein}g protein, ${i.fiber}g fiber, ${i.fat}g fat`
      )
      .join("; ");

    const totals = json.totals;
    const message = `Tracked: ${itemsText}. Total — ${totals.calories} cal, ${totals.carbs}g carbs, ${totals.protein}g protein, ${totals.fiber}g fiber, ${totals.fat}g fat.`;

    const updatedGoal = await applyDailyGoalUpdate(uid, json.totals);

    res.status(200).send({ message, items: json.items, goal: updatedGoal, });
  } catch (err) {
    console.error("OpenAI error:", err);
    res.status(500).send({ message: err });
  }
});
exports.trackFoodImage = onRequest(async (req, res) => {
  try {
    const { uid, image } = req.body;
    if (!uid || !image) return res.status(400).send({ message: 'Missing uid or image data' });

    const matches = image.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) return res.status(400).send({ message: 'Invalid image format' });

    const ext = matches[1];
    const buffer = Buffer.from(matches[2], 'base64');
    const filename = `chat-images/${uid}_${Date.now()}.${ext}`;
    const file = bucket.file(filename);
    const uuid = uuidv4();

    await file.save(buffer, {
      metadata: {
        contentType: `image/${ext}`,
        metadata: { firebaseStorageDownloadTokens: uuid },
      }
    });

    const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filename)}?alt=media&token=${uuid}`;

    // Vision API request
    const visionPrompt = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `You are a nutrition assistant that identifies food and estimates nutrition from photos. Extract the following details from the uploaded image:
- Food items
- Quantity
- Estimated calories
- Carbohydrates (grams)
- Protein (grams)
- Fiber (grams)
- Fat (grams)

Return the response in the following JSON format:
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
      model: "gpt-4.1-mini",
      messages: visionPrompt,
      max_tokens: 1000,
    });

    const json = JSON.parse(visionRes.choices[0].message.content);

    const itemsText = json.items
      .map(
        (i) =>
          `${i.quantity} ${i.name} - ${i.calories} cal, ${i.carbs}g carbs, ${i.protein}g protein, ${i.fiber}g fiber, ${i.fat}g fat`
      )
      .join("; ");

    const totals = json.totals;
    const summaryText = `Tracked: ${itemsText}. Total — ${totals.calories} cal, ${totals.carbs}g carbs, ${totals.protein}g protein, ${totals.fiber}g fiber, ${totals.fat}g fat.`;

    await db
      .collection("users")
      .doc(uid)
      .collection("foodLogs")
      .add({
        input: '[Image]',
        ...json,
        imageUrl,
        timestamp: new Date(),
        source: "openai-vision",
      });
    const updatedGoal = await applyDailyGoalUpdate(uid, json.totals);
    return res.status(200).send({
      message: summaryText,
      items: json.items,
      nutrition: json.totals,
      goal: updatedGoal,
    });

  } catch (err) {
    console.error(err);
    return res.status(500).send({ message: 'Failed to process image.' });
  }
});

