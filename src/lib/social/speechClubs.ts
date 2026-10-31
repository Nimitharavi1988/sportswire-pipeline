// Club names for the voice (2026-10-31: "name of the clubs should be pronounced properly"). Only clubs a voice is likely to get wrong
// are respelled; plain English names (Arsenal, Chelsea, Liverpool, Everton) are left alone. Same convention as speechNames.ts: real
// spelling on the left, how it sounds on the right, plain English letters. Written from how the clubs are said, not heard yet: a club
// heard wrong goes in here after the listening test. Kept apart from speechNames.ts and merged there.
export const CLUB_SPEECH: Record<string, string> = {
  // England and Scotland
  Tottenham: "Totnum", Leicester: "Lester", Bournemouth: "Bornmuth", Wolverhampton: "Woolverhampton", Wolves: "Woolvz", Fulham: "Fulum", Norwich: "Norrich",
  Middlesbrough: "Middlesbruh", "Nottingham Forest": "Nottingum Forest", Nottingham: "Nottingum", Celtic: "Seltic", Hibernian: "Hibearnian",
  // Spain
  "Real Madrid": "Rayal Madrid", "Atlético Madrid": "Atletico Madrid", "Atletico Madrid": "Atletico Madrid", "Real Sociedad": "Rayal Sosiedad", "Real Betis": "Rayal Betis",
  Sevilla: "Sevilya", "Athletic Bilbao": "Athletic Bilbow", Bilbao: "Bilbow", Getafe: "Hetafay", Espanyol: "Espanyole", "Celta Vigo": "Selta Veego", Girona: "Heerona",
  Osasuna: "Osasoona", Mallorca: "Maiorka",
  // Italy
  Juventus: "Yoovehntus", Napoli: "Nahpolee", Lazio: "Lahtsio", Fiorentina: "Feeorenteena", Udinese: "Oodeenayzay", Genoa: "Jenoa", Cagliari: "Kalyaree",
  Sassuolo: "Sasswolo", Bologna: "Bolonya", Lecce: "Letchay", Como: "Komo", Internazionale: "Inter Milan", Atalanta: "Atalanta",
  // Germany
  Bayern: "Buyern", Borussia: "Borooseeya", "Borussia Dortmund": "Borooseeya Dortmund", Leverkusen: "Layverkoozen", "Eintracht Frankfurt": "Eyntracht Frankfurt",
  Eintracht: "Eyntracht", "RB Leipzig": "R B Lypzig", Leipzig: "Lypzig", Stuttgart: "Shtootgart", Hoffenheim: "Hoffenhyme", Schalke: "Shalka", Wolfsburg: "Volfsboorg",
  Freiburg: "Fryboorg", Mainz: "Mynts", Augsburg: "Owgsboorg", "Werder Bremen": "Vayrder Brehmen", Köln: "Keln", Mönchengladbach: "Murnchengladbahk",
  Gladbach: "Gladbahk", Heidenheim: "Hydenhime", Elversberg: "Elversbairg", Paderborn: "Paderborn",
  // France
  Marseille: "Marsay", Lyon: "Leeyon", Lille: "Leel", Lens: "Lonss", Rennes: "Renn", Nantes: "Nont", Strasbourg: "Strazboorg", Toulouse: "Toolooz",
  Montpellier: "Monpellyay", Auxerre: "Ohsair", Lorient: "Loryon", Angers: "Onjay", Reims: "Rance", "Le Havre": "Luh Havr", "Saint-Étienne": "Santaytyen",
  // Netherlands, Portugal, Turkey, Belgium
  Ajax: "Eyax", Feyenoord: "Fayenoort", Eindhoven: "Eyndhoaven", Benfica: "Benfeeka", Porto: "Portoo", Braga: "Brahga", Galatasaray: "Galatasarai",
  Fenerbahce: "Fenerbahche", Fenerbahçe: "Fenerbahche", Besiktas: "Beshiktash", Beşiktaş: "Beshiktash", Anderlecht: "Anderlecht",
  // Brazil, Argentina, Colombia, Mexico
  Fluminense: "Floominensay", Grêmio: "Gremeeo", Gremio: "Gremeeo", "São Paulo": "Sow Pawlo", "Sao Paulo": "Sow Pawlo", "Atlético Mineiro": "Atletico Meenayro",
  Cruzeiro: "Kroozayro", Botafogo: "Botafogo", Vasco: "Vasko", Gimnasia: "Heemnasia", "Vélez Sarsfield": "Velez Sarsfield", Velez: "Velez", Sarmiento: "Sarmyento",
  Millonarios: "Meelyonareeos", "América de Cali": "Amereeka de Kahlee", Chivas: "Cheevas", Tigres: "Teegres", Rayados: "Rayados", Monterrey: "Monterray",
};
