import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY });

const PERSONAS = [
  {
    id: "ADVISOR",
    name: "Dr. Aris Thorne",
    visualDescription: "A 60-year-old Black male professor with silver hair and glasses, professional academic setting, high quality portrait."
  },
  {
    id: "PEER_COLLABORATOR",
    name: "Dr. Jamie Chen",
    visualDescription: "A 35-year-old East Asian non-binary researcher with short hair, lab setting, professional academic portrait."
  },
  {
    id: "HIRING_MANAGER",
    name: "Sarah Davis",
    visualDescription: "A 40-year-old Hispanic female corporate manager in a sharp blazer, office setting, professional portrait."
  },
  {
    id: "COMMITTEE_CHAIR",
    name: "Dr. Robert Vance",
    visualDescription: "A 55-year-old White male academic with a beard and tweed jacket, library setting, professional academic portrait."
  },
  {
    id: "DEAN",
    name: "Dean Eleanor Sterling",
    visualDescription: "A 65-year-old Black female university dean with an authoritative yet warm presence, formal office setting, professional portrait."
  },
  {
    id: "JOURNAL_EDITOR",
    name: "Dr. Marcus Hayes",
    visualDescription: "A 50-year-old Middle Eastern male journal editor with a meticulous appearance, office setting, professional portrait."
  },
  {
    id: "ETHICS_OFFICER",
    name: "Dr. Amina Patel",
    visualDescription: "A 45-year-old South Asian female ethics officer with a serious expression, office setting, professional portrait."
  },
  {
    id: "GRANT_REVIEWER",
    name: "Dr. Samuel Lewis",
    visualDescription: "A 60-year-old Indigenous male grant reviewer with a thoughtful demeanor, office setting, professional portrait."
  },
  {
    id: "ADMISSIONS_DEAN",
    name: "Dr. Evelyn Reed",
    visualDescription: "A 50-year-old White female dean with a sharp, professional look and a warm smile, office setting, professional portrait."
  },
  {
    id: "DEPARTMENT_HEAD",
    name: "Professor Kenji Tanaka",
    visualDescription: "A 55-year-old East Asian male professor with a pragmatic and strategic demeanor, office setting, professional portrait."
  },
  {
    id: "OMBUDS_OFFICER",
    name: "Dr. Sarah Jenkins",
    visualDescription: "A 50-year-old White female ombuds officer with a calm and neutral expression, office setting, professional portrait."
  },
  {
    id: "FACULTY_MENTOR",
    name: "Dr. Michael Ross",
    visualDescription: "A 45-year-old Black male faculty mentor with a supportive and encouraging look, office setting, professional portrait."
  }
];

async function generatePortraits() {
  const portraitsDir = path.join(process.cwd(), "public", "portraits");
  if (!fs.existsSync(portraitsDir)) {
    fs.mkdirSync(portraitsDir, { recursive: true });
  }

  for (const persona of PERSONAS) {
    const filePath = path.join(portraitsDir, `${persona.id}.png`);
    if (fs.existsSync(filePath)) {
      console.log(`Skipping ${persona.id}, already exists.`);
      continue;
    }

    console.log(`Generating portrait for ${persona.name} (${persona.id})...`);
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [
          {
            parts: [
              {
                text: persona.visualDescription,
              },
            ],
          },
        ],
      });

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          const base64Data = part.inlineData.data;
          fs.writeFileSync(filePath, Buffer.from(base64Data, "base64"));
          console.log(`Saved ${persona.id}.png`);
        }
      }
    } catch (error) {
      console.error(`Error generating portrait for ${persona.id}:`, error);
    }
  }
}

generatePortraits();
