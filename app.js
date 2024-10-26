const { createBot, createProvider, createFlow, addKeyword } = require('@bot-whatsapp/bot');
const QRPortalWeb = require('@bot-whatsapp/portal');
const BaileysProvider = require('@bot-whatsapp/provider/baileys');
const JsonFileAdapter = require('@bot-whatsapp/database/json');
const { downloadMediaMessage } = require("@adiwajshing/baileys");
const ffmpeg = require("fluent-ffmpeg");
const https = require("https"); // Importar https
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require("@google/generative-ai/server");
require("dotenv").config();

ffmpeg.setFfmpegPath(ffmpegPath);


const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Variable para almacenar los datos de ventas y productos
let salesProductsData = null;

// Función para cargar el archivo de audio y obtener la URI
async function uploadAudioFile(audioPath) {
  try {
    const fileManager = new GoogleAIFileManager(process.env.API_KEY);
    const audioFile = await fileManager.uploadFile(audioPath, {
      mimeType: "audio/mp3",
    });
    return audioFile;
  } catch (error) {
    console.error("Error al subir el archivo de audio:", error);
    throw new Error("Error al subir el archivo de audio.");
  }
}

// Definición de `flowVoiceNote`
const flowVoiceNote = addKeyword(['voz']).addAnswer(
  "Envíame tu nota de voz.",
  { capture: true },
  async (ctx, { flowDynamic }) => {
    try {
      const tmpDir = path.join(process.cwd(), "tmp");
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

      const filePathOgg = path.join(tmpDir, `voice-note-${Date.now()}.ogg`);
      const filePathMp3 = path.join(tmpDir, `voice-note-${Date.now()}.mp3`);

      const buffer = await downloadMediaMessage(ctx, "buffer");
      fs.writeFileSync(filePathOgg, buffer);
      console.log(`Audio OGG guardado en: ${filePathOgg}`);

      await new Promise((resolve, reject) => {
        ffmpeg(filePathOgg)
          .toFormat("mp3")
          .on("end", () => {
            console.log(`Audio convertido a MP3 y guardado en: ${filePathMp3}`);
            resolve();
          })
          .on("error", (error) => {
            console.error("Error al convertir el archivo a MP3:", error);
            reject(error);
          })
          .save(filePathMp3);
      });

      const audioFile = await uploadAudioFile(filePathMp3);

      const result = await model.generateContent([
        {
          fileData: {
            mimeType: audioFile.file.mimeType,
            fileUri: audioFile.file.uri,
          },
        },
        { text: "Transcribe the speech" },
      ]);

      const transcribeText = result.response.text();
      console.log("Transcripción:", transcribeText);

      const prompt = `Un dueño de una tienda de abarrotes te hace una pregunta sobre sus productos y ventas: Datos de productos y ventas de la tienda: ${JSON.stringify(salesProductsData)}. Pregunta: ${transcribeText}`;
      const resultText = await model.generateContent(prompt);
      const aiResponse = resultText.response.text();
      console.log("Respuesta AI:", aiResponse);
      await flowDynamic(aiResponse);

      fs.unlinkSync(filePathOgg);
      fs.unlinkSync(filePathMp3);

    } catch (error) {
      console.error("Error al procesar la nota de voz:", error);
      await flowDynamic("Hubo un error al procesar tu nota de voz. Intenta nuevamente.");
    }
  }
);

// `flowText` usando los datos de ventas y productos
const flowText = addKeyword(['texto']).addAnswer(
  '¿Qué duda o preocupación tienes sobre tus productos y ventas?.',
  { capture: true },
  async (ctx, { flowDynamic }) => {
    if (!salesProductsData) {
      await flowDynamic("No se encontraron datos de productos y ventas.");
      return;
    }

    const prompt = `Un dueño de una tienda de abarrotes te hace una pregunta sobre sus productos y ventas: Datos de productos y ventas de la tienda: ${JSON.stringify(salesProductsData)}. Pregunta: ${ctx.body}`;
    console.log(prompt);

    try {
      const result = await model.generateContent(prompt);
      const aiResponse = result.response.text();
      console.log(aiResponse);
      await flowDynamic(aiResponse);
    } catch (error) {
      console.error("Error generando contenido:", error);
      await flowDynamic("Hubo un error al generar la respuesta, intenta nuevamente más tarde.");
    }
  }
);

const flowPrincipal = addKeyword(['nanostore']).addAnswer(
  'Hola! Soy tu asistente personal para tu tienda de abarrotes, escribe la palabra entre comillas para seleccionar una opción.',
  { delay: 1500 }
).addAnswer([
  '👉 "texto" - Consulta sobre productos y ventas (texto)',
  '👉 "voz" - Consulta sobre productos y ventas (audio)',
]);

// Función para hacer la solicitud a la API sin `node-fetch`
async function fetchSalesData() {
  return new Promise((resolve, reject) => {
    https.get("https://pruebaswebjulian.com/get-sales-products", (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          salesProductsData = JSON.parse(data);
          console.log("Datos de productos y ventas cargados:", salesProductsData);
          resolve(salesProductsData);
        } catch (error) {
          reject("Error al analizar los datos JSON.");
        }
      });
    }).on("error", (error) => {
      reject("Error al obtener los datos de productos y ventas:", error);
    });
  });
}

// Función principal para iniciar el bot y cargar los datos de ventas
const main = async () => {
  try {
    await fetchSalesData();
  } catch (error) {
    console.error(error);
  }

  // Inicializar el bot
  const adapterDB = new JsonFileAdapter();
  const adapterFlow = createFlow([flowPrincipal, flowText, flowVoiceNote]);
  const adapterProvider = createProvider(BaileysProvider);

  createBot({
    flow: adapterFlow,
    provider: adapterProvider,
    database: adapterDB,
  });

  QRPortalWeb();
};

main();
