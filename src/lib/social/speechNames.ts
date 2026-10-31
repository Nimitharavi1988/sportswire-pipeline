// How a voice should say names it would otherwise get wrong (2026-10-31, after the first listening test: "names are not pronounced
// properly"). Kokoro reads a name by its spelling, so each hard name is respelled the way it sounds, in plain English letters. Only
// the spoken text changes; the caption and the on-screen text keep the real spelling. Start of the list: the cricket, MMA/boxing and
// football names that came up most in the October headlines. Grow it from the listening tests (a name heard wrong goes in here).
// Pure, unit-tested.

// "Real spelling": "how it sounds". Longer keys are applied first, so a full name wins over its surname.
export const SPEECH_NAMES: Record<string, string> = {
  // cricket: India
  "Virat Kohli": "Veerat Kohlee", Kohli: "Kohlee", "Rohit Sharma": "Rohit Sharma", "Jasprit Bumrah": "Jusprit Boomrah", Bumrah: "Boomrah",
  "Kuldeep Yadav": "Kooldeep Yaadav", Kuldeep: "Kooldeep", Yadav: "Yaadav", "Suryakumar Yadav": "Sooryakumar Yaadav", Suryakumar: "Sooryakumar",
  "MS Dhoni": "M S Dhonee", Dhoni: "Dhonee", "Ravindra Jadeja": "Ravindra Jadayja", Jadeja: "Jadayja", "Mohammed Siraj": "Mohammed Siraaj", Siraj: "Siraaj",
  "Ruturaj Gaikwad": "Rootooraj Gaikwaad", Gaikwad: "Gaikwaad", "Vaibhav Sooryavanshi": "Vybhav Sooryavanshee", Sooryavanshi: "Sooryavanshee",
  Suryavanshi: "Sooryavanshee", Vaibhav: "Vybhav", "Shubman Gill": "Shubman Gill", "Hardik Pandya": "Hardik Paandya", Pandya: "Paandya",
  "Ajinkya Rahane": "Ajinkya Rahaanay", Rahane: "Rahaanay", "Shreyas Iyer": "Shreyas Eyer", Iyer: "Eyer", "Rishabh Pant": "Rishub Pant", Rishabh: "Rishub",
  "Yashasvi Jaiswal": "Yashasvee Jaiswaal", Jaiswal: "Jaiswaal", "Ishan Kishan": "Ishaan Kishan", "Axar Patel": "Akshar Patel", Axar: "Akshar",
  "Arshdeep Singh": "Arshdeep Sing", Arshdeep: "Arshdeep", "Tilak Varma": "Tilak Varma", "Washington Sundar": "Washington Soondar",
  "Dhruv Jurel": "Dhroov Joorel", "Naman Dhir": "Naman Dheer", "Varun Chakravarthy": "Varoon Chakravarthee", "Prasidh Krishna": "Prasid Krishna",
  "Smriti Mandhana": "Smritee Mandhaana", Mandhana: "Mandhaana", "Harmanpreet Kaur": "Harmanpreet Kor", Harmanpreet: "Harmanpreet", "Shafali Verma": "Shaafalee Verma",
  Shafali: "Shaafalee", "Jemimah Rodrigues": "Jemyma Rodreegez", Jemimah: "Jemyma", "Abhishek Sharma": "Abhishek Sharma", "Sanju Samson": "Sanjoo Samson",
  Sanju: "Sanjoo", "Gautam Gambhir": "Gowtam Gambheer", Gambhir: "Gambheer", "Sachin Tendulkar": "Sachin Tendoolkar", Tendulkar: "Tendoolkar",
  // cricket: world
  "Babar Azam": "Baabar Aazam", Babar: "Baabar", Azam: "Aazam", "Shaheen Afridi": "Shaheen Afreedee", Afridi: "Afreedee", "Mohammad Rizwan": "Mohammad Rizwaan",
  Rizwan: "Rizwaan", "Rashid Khan": "Rashid Kaan", "Marnus Labuschagne": "Marnus Labooshayn", Labuschagne: "Labooshayn", "Wanindu Hasaranga": "Wanindu Hasarunga",
  Hasaranga: "Hasarunga", "Quinton de Kock": "Kwinton de Kok", "de Kock": "de Kok", Zampa: "Zampa", "Brydon Carse": "Brydon Carse", "Sikandar Raza": "Sikunder Razza",
  "Kane Williamson": "Kane Williamson", Boult: "Bolt", "Ryan Rickelton": "Ryan Rickelton", Rickelton: "Rickelton",
  // cricket: places
  Wankhede: "Wankhaydee", Chepauk: "Chepawk", Chinnaswamy: "Chinnaswaamee", Thiruvananthapuram: "Tiruvananthapuram", Lahore: "Lahore",
  // MMA and boxing
  "Islam Makhachev": "Islaam Mahkahchev", Makhachev: "Mahkahchev", "Merab Dvalishvili": "Merab Dvaleeshveelee", Dvalishvili: "Dvaleeshveelee",
  "Ilia Topuria": "Ilya Topooria", Topuria: "Topooria", "Alexander Volkanovski": "Alexander Volkanovskee", Volkanovski: "Volkanovskee",
  "Alex Pereira": "Alex Perayra", Pereira: "Perayra", "Khamzat Chimaev": "Khamzat Chimayev", Chimaev: "Chimayev", "Paddy Pimblett": "Paddy Pimblett",
  "Jiri Prochazka": "Yeeree Prohaska", Prochazka: "Prohaska", "Justin Gaethje": "Justin Gaychee", Gaethje: "Gaychee", "Charles Oliveira": "Charles Oleeveyra",
  Oliveira: "Oleeveyra", "Khabib Nurmagomedov": "Khabeeb Noormagomedov", Nurmagomedov: "Noormagomedov", "Magomed Ankalaev": "Magomed Ankalayev", Ankalaev: "Ankalayev",
  "Arman Tsarukyan": "Arman Tsarookyan", Tsarukyan: "Tsarookyan", "Movsar Evloev": "Movsar Evloyev", Evloev: "Evloyev", "Carlos Prates": "Carlos Prahtess", Prates: "Prahtess",
  "Dustin Poirier": "Dustin Pwahreeay", Poirier: "Pwahreeay", "Francis Ngannou": "Francis Nganoo", Ngannou: "Nganoo", "Dricus du Plessis": "Dricus du Plessee",
  "Zhang Weili": "Jang Wayli", Weili: "Wayli", "Henry Cejudo": "Henry Sayhoodo", Cejudo: "Sayhoodo", "Israel Adesanya": "Israel Adesahnya", Adesanya: "Adesahnya",
  "Deiveson Figueiredo": "Dayveson Figayredo", Figueiredo: "Figayredo", "Renato Moicano": "Renato Moykano", Moicano: "Moykano", "Roberto Soldic": "Roberto Soldich",
  "Oleksandr Usyk": "Oleksandr Oosik", Usyk: "Oosik", "Canelo Alvarez": "Kahnelo Alvarez", Canelo: "Kahnelo", "Artur Beterbiev": "Artur Beterbeeyev", Beterbiev: "Beterbeeyev",
  "Dmitry Bivol": "Dmitry Beevol", Bivol: "Beevol", "Naoya Inoue": "Nah-oya Eenohway", Inoue: "Eenohway", "Joe Rogan": "Joe Rogan", "Daniel Cormier": "Daniel Cormeer",
  "Sean O'Malley": "Shawn O'Malley", "Sean Strickland": "Shawn Strickland", "Sean Brady": "Shawn Brady", "Jose Aldo": "Hose Aldo", "Natalia Silva": "Natalia Silva",
  // football
  "Kylian Mbappe": "Keelian Embappay", "Kylian Mbappé": "Keelian Embappay", Mbappe: "Embappay", Mbappé: "Embappay", "Erling Haaland": "Erling Hawlund",
  Haaland: "Hawlund", "Vinicius Junior": "Veeneesius Junior", Vinicius: "Veeneesius", Vinícius: "Veeneesius", "Robert Lewandowski": "Robert Levandovskee",
  Lewandowski: "Levandovskee", "Florian Wirtz": "Florian Virts", Wirtz: "Virts", "Lamine Yamal": "Lameen Yamahl", Yamal: "Yamahl", Dembélé: "Dombelay",
  Dembele: "Dombelay", Griezmann: "Greezman", "Viktor Gyokeres": "Viktor Yurkeresh", Gyokeres: "Yurkeresh", Gyökeres: "Yurkeresh", "Alexander Isak": "Alexander Eesak",
  Isak: "Eesak", "Martin Odegaard": "Martin Urdegaard", Odegaard: "Urdegaard", Ødegaard: "Urdegaard", Raphinha: "Rafeenya", "Victor Osimhen": "Victor Oseemen",
  Osimhen: "Oseemen", "Lautaro Martinez": "Lautaro Marteenez", "Kevin De Bruyne": "Kevin de Brooyna", "De Bruyne": "de Brooyna", "Virgil van Dijk": "Virgil van Dyke",
  "van Dijk": "van Dyke", "Son Heung-min": "Son Hyoongmin", "Mohamed Salah": "Mohamed Salah", Villarreal: "Veeyareal", Marseille: "Marsay", Lyon: "Leeyon",
  Palmeiras: "Palmayras", Flamengo: "Flamengo", Corinthians: "Corinthians", Mirassol: "Meerassol", "Rosario Central": "Rosario Central",
};

const ENTRIES: [RegExp, string][] = Object.entries(SPEECH_NAMES)
  .filter(([k, v]) => k !== v)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([k, v]) => [new RegExp(`(?<![\\p{L}\\p{N}])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "gu"), v]);

// The text with each hard name respelled for the voice. Names are matched whole and case-sensitively, so "Kohli" is changed but
// "Kohlis" and "kohli" are not.
export function applySpeechNames(text: string): string {
  let out = text;
  for (const [re, spoken] of ENTRIES) out = out.replace(re, spoken);
  return out;
}
