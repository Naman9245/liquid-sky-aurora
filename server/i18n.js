'use strict';

/**
 * Hindi and Kannada for the menu.
 *
 * Indian dish names are built from a small vocabulary that repeats: "Chicken",
 * "Masala", "Fried", "Rice". 209 words cover all 280 dishes, so the menu is
 * translated word by word rather than dish by dish. Fix a word here and every
 * dish using it is fixed at once.
 *
 * Two deliberate choices:
 *  - Where a name is a borrowed food term ("Biriyani", "Manchurian") it is
 *    transliterated, not translated, because that is what people say.
 *  - An unknown word is left in English rather than guessed at. A half-English
 *    name a diner can still read beats a confident mistranslation.
 *
 * OVERRIDES win over word-by-word, for the handful of dishes where composing
 * the words produces something no one would say.
 */

// english: [hindi, kannada]
const TERMS = {
  /* Liquid Sky's bar and its section headings — vocabulary the original
     multi-cuisine card never needed. */
  Boondi: ['बूंदी', 'ಬೂಂದಿ'], Raita: ['रायता', 'ರಾಯ್ತ'],
  Wine: ['वाइन', 'ವೈನ್'], Red: ['रेड', 'ರೆಡ್'], White: ['व्हाइट', 'ವೈಟ್'],
  Rose: ['रोज़', 'ರೋಸ್'], Strong: ['स्ट्रॉन्ग', 'ಸ್ಟ್ರಾಂಗ್'],
  Premium: ['प्रीमियम', 'ಪ್ರೀಮಿಯಂ'], Smooth: ['स्मूद', 'ಸ್ಮೂತ್'],
  Tandoor: ['तंदूर', 'ತಂದೂರಿ'], Soups: ['सूप', 'ಸೂಪ್'], Mains: ['मुख्य व्यंजन', 'ಮುಖ್ಯ ಖಾದ್ಯ'],
  Coastal: ['तटीय', 'ಕರಾವಳಿ'], Breads: ['रोटी', 'ರೊಟ್ಟಿ'], Sides: ['साइड्स', 'ಸೈಡ್ಸ್'],
  Mocktails: ['मॉकटेल', 'ಮಾಕ್‌ಟೈಲ್'], Cocktails: ['कॉकटेल', 'ಕಾಕ್‌ಟೈಲ್'],
  Spirits: ['स्पिरिट्स', 'ಸ್ಪಿರಿಟ್ಸ್'], Starters: ['स्टार्टर', 'ಸ್ಟಾರ್ಟರ್'],
  Desserts: ['मिठाई', 'ಸಿಹಿ'], Chinese: ['चाइनीज़', 'ಚೈನೀಸ್'], Biryani: ['बिरयानी', 'ಬಿರಿಯಾನಿ'],
  /* proteins and vegetables */
  Chicken: ['चिकन', 'ಚಿಕನ್'], Mutton: ['मटन', 'ಮಟನ್'], Prawns: ['झींगा', 'ಸೀಗಡಿ'],
  Fish: ['मछली', 'ಮೀನು'], Egg: ['अंडा', 'ಮೊಟ್ಟೆ'], Paneer: ['पनीर', 'ಪನೀರ್'],
  Mushroom: ['मशरूम', 'ಅಣಬೆ'], Veg: ['वेज', 'ವೆಜ್'], Gobi: ['गोभी', 'ಹೂಕೋಸು'],
  Aloo: ['आलू', 'ಆಲೂಗಡ್ಡೆ'], Potato: ['आलू', 'ಆಲೂಗಡ್ಡೆ'], Corn: ['कॉर्न', 'ಕಾರ್ನ್'],
  Baby: ['बेबी', 'ಬೇಬಿ'], Bhindi: ['भिंडी', 'ಬೆಂಡೆಕಾಯಿ'], Peas: ['मटर', 'ಬಟಾಣಿ'],
  Kaju: ['काजू', 'ಗೋಡಂಬಿ'], Onion: ['प्याज', 'ಈರುಳ್ಳಿ'], Tomato: ['टमाटर', 'ಟೊಮೇಟೊ'],
  Palak: ['पालक', 'ಪಾಲಕ್'], Mattar: ['मटर', 'ಬಟಾಣಿ'], Cucumber: ['खीरा', 'ಸೌತೆಕಾಯಿ'],
  Peanut: ['मूंगफली', 'ಕಡಲೆಕಾಯಿ'],

  /* dishes and forms */
  Rice: ['राइस', 'ರೈಸ್'], Fried: ['फ्राइड', 'ಫ್ರೈಡ್'], Noodles: ['नूडल्स', 'ನೂಡಲ್ಸ್'],
  Masala: ['मसाला', 'ಮಸಾಲ'], Biriyani: ['बिरयानी', 'ಬಿರಿಯಾನಿ'], Pulao: ['पुलाव', 'ಪುಲಾವ್'],
  Curry: ['करी', 'ಕರಿ'], Dal: ['दाल', 'ಬೇಳೆ'], Soup: ['सूप', 'ಸೂಪ್'],
  Salad: ['सलाद', 'ಸಲಾಡ್'], Sandwich: ['सैंडविच', 'ಸ್ಯಾಂಡ್‌ವಿಚ್'], Pakoda: ['पकोड़ा', 'ಪಕೋಡ'],
  Paratha: ['पराठा', 'ಪರಾಠ'], Chapati: ['चपाती', 'ಚಪಾತಿ'], Phulka: ['फुल्का', 'ಫುಲ್ಕಾ'],
  Dosa: ['दोसा', 'ದೋಸೆ'], Idly: ['इडली', 'ಇಡ್ಲಿ'], Wada: ['वड़ा', 'ವಡೆ'],
  Medu: ['मेदु', 'ಮೆದು'], Poori: ['पूरी', 'ಪೂರಿ'], Bhaji: ['भाजी', 'ಭಾಜಿ'],
  Pongal: ['पोंगल', 'ಪೊಂಗಲ್'], Kesari: ['केसरी', 'ಕೇಸರಿ'], Bath: ['बाथ', 'ಬಾತ್'],
  Khichdi: ['खिचड़ी', 'ಖಿಚಡಿ'], Pasta: ['पास्ता', 'ಪಾಸ್ತಾ'], Maggi: ['मैगी', 'ಮ್ಯಾಗಿ'],
  Maggie: ['मैगी', 'ಮ್ಯಾಗಿ'], Omlet: ['ऑमलेट', 'ಆಮ್ಲೆಟ್'], Toast: ['टोस्ट', 'ಟೋಸ್ಟ್'],
  Bread: ['ब्रेड', 'ಬ್ರೆಡ್'], Cornflakes: ['कॉर्नफ्लेक्स', 'ಕಾರ್ನ್‌ಫ್ಲೇಕ್ಸ್'],
  Papad: ['पापड़', 'ಹಪ್ಪಳ'], Fries: ['फ्राइज़', 'ಫ್ರೈಸ್'], French: ['फ्रेंच', 'ಫ್ರೆಂಚ್'],
  Nuggets: ['नगेट्स', 'ನಗೆಟ್ಸ್'], Ball: ['बॉल', 'ಬಾಲ್'], Cheese: ['चीज़', 'ಚೀಸ್'],
  Curd: ['दही', 'ಮೊಸರು'], Raitha: ['रायता', 'ರಾಯ್ತಾ'], Kebab: ['कबाब', 'ಕಬಾಬ್'],
  Kabab: ['कबाब', 'ಕಬಾಬ್'], Lolipop: ['लॉलीपॉप', 'ಲಾಲಿಪಾಪ್'], Drums: ['ड्रम्स', 'ಡ್ರಮ್ಸ್'],
  Heaven: ['हेवन', 'ಹೆವನ್'], Combo: ['कॉम्बो', 'ಕಾಂಬೊ'], Thali: ['थाली', 'ಥಾಲಿ'],
  Meals: ['मील्स', 'ಮೀಲ್ಸ್'], Alfredo: ['अल्फ्रेडो', 'ಅಲ್ಫ್ರೆಡೊ'],

  /* preparations and styles */
  Shezwan: ['शेज़वान', 'ಶೆಜ್ವಾನ್'], Chilli: ['चिली', 'ಚಿಲ್ಲಿ'],
  Manchurian: ['मंचूरियन', 'ಮಂಚೂರಿಯನ್'], Pepper: ['पेपर', 'ಪೆಪ್ಪರ್'],
  Dry: ['ड्राई', 'ಡ್ರೈ'], Chinese: ['चाइनीज़', 'ಚೈನೀಸ್'], Cream: ['क्रीम', 'ಕ್ರೀಮ್'],
  Manchow: ['मंचाउ', 'ಮಂಚೌ'], Clear: ['क्लियर', 'ಕ್ಲಿಯರ್'], Sour: ['सॉर', 'ಸೋರ್'],
  Hot: ['हॉट', 'ಹಾಟ್'], Sweet: ['स्वीट', 'ಸ್ವೀಟ್'], Coriander: ['धनिया', 'ಕೊತ್ತಂಬರಿ'],
  Lemon: ['नींबू', 'ನಿಂಬೆ'], Ghee: ['घी', 'ತುಪ್ಪ'], Roast: ['रोस्ट', 'ರೋಸ್ಟ್'],
  Kadai: ['कड़ाही', 'ಕಡಾಯಿ'], Kolhapuri: ['कोल्हापुरी', 'ಕೊಲ್ಹಾಪುರಿ'],
  Dopyaza: ['दोप्याज़ा', 'ದೋಪ್ಯಾಜ'], Lababdar: ['लबाबदार', 'ಲಬಾಬ್ದಾರ್'],
  Butter: ['बटर', 'ಬೆಣ್ಣೆ'], Roganjosh: ['रोगन जोश', 'ರೋಗನ್ ಜೋಶ್'],
  Chettinad: ['चेट्टीनाड', 'ಚೆಟ್ಟಿನಾಡ್'], Hyderabadi: ['हैदराबादी', 'ಹೈದರಾಬಾದಿ'],
  Patiala: ['पटियाला', 'ಪಟಿಯಾಲ'], Murgh: ['मुर्ग', 'ಮುರ್ಗ್'], Andhra: ['आंध्रा', 'ಆಂಧ್ರ'],
  Tawa: ['तवा', 'ತವಾ'], Chukka: ['चुक्का', 'ಚುಕ್ಕ'], Dum: ['दम', 'ದಮ್'],
  Tadka: ['तड़का', 'ತಡಕಾ'], Lahsuni: ['लहसुनी', 'ಲಸುಣಿ'], Yellow: ['पीली', 'ಹಳದಿ'],
  Jeera: ['जीरा', 'ಜೀರಿಗೆ'], Kashmiri: ['कश्मीरी', 'ಕಾಶ್ಮೀರಿ'], Basmati: ['बासमती', 'ಬಾಸ್ಮತಿ'],
  Steam: ['स्टीम', 'ಸ್ಟೀಮ್'], Kerala: ['केरल', 'ಕೇರಳ'], Lachha: ['लच्छा', 'ಲಚ್ಛಾ'],
  Laccha: ['लच्छा', 'ಲಚ್ಛಾ'], Stuffed: ['स्टफ्ड', 'ಸ್ಟಫ್ಡ್'], Grilled: ['ग्रिल्ड', 'ಗ್ರಿಲ್ಡ್'],
  Grill: ['ग्रिल', 'ಗ್ರಿಲ್'], Club: ['क्लब', 'ಕ್ಲಬ್'], Crispy: ['क्रिस्पी', 'ಕ್ರಿಸ್ಪಿ'],
  Dragon: ['ड्रैगन', 'ಡ್ರ್ಯಾಗನ್'], Honey: ['हनी', 'ಜೇನು'], Golden: ['गोल्डन', 'ಗೋಲ್ಡನ್'],
  Fry: ['फ्राई', 'ಫ್ರೈ'], Salt: ['नमक', 'ಉಪ್ಪು'], Plain: ['प्लेन', 'ಪ್ಲೇನ್'],
  Set: ['सेट', 'ಸೆಟ್'], Cut: ['कटा', 'ಕಟ್'], Mix: ['मिक्स', 'ಮಿಕ್ಸ್'],
  Green: ['ग्रीन', 'ಹಸಿರು'], Black: ['ब्लैक', 'ಬ್ಲ್ಯಾಕ್'], Blue: ['ब्लू', 'ಬ್ಲೂ'],
  Fresh: ['फ्रेश', 'ತಾಜಾ'], Roasted: ['रोस्टेड', 'ಹುರಿದ'], Boiled: ['उबला', 'ಬೇಯಿಸಿದ'],
  Half: ['हाफ', 'ಹಾಫ್'], Snack: ['स्नैक', 'ಸ್ನ್ಯಾಕ್'], Russian: ['रशियन', 'ರಷ್ಯನ್'],
  Kachumber: ['कचुंबर', 'ಕಚುಂಬರ್'], Chatpata: ['चटपटा', 'ಚಟ್ಪಟ'],

  /* words this menu does not use yet, but a new dish likely will */
  Tikka: ['टिक्का', 'ಟಿಕ್ಕಾ'], Tandoori: ['तंदूरी', 'ತಂದೂರಿ'], Naan: ['नान', 'ನಾನ್'],
  Roti: ['रोटी', 'ರೊಟ್ಟಿ'], Kulcha: ['कुल्चा', 'ಕುಲ್ಚಾ'], Seekh: ['सीख', 'ಸೀಖ್'],
  Malai: ['मलाई', 'ಮಲೈ'], Achari: ['अचारी', 'ಅಚಾರಿ'], Handi: ['हांडी', 'ಹಂಡಿ'],
  Biryani: ['बिरयानी', 'ಬಿರಿಯಾನಿ'], Tikki: ['टिक्की', 'ಟಿಕ್ಕಿ'], Kofta: ['कोफ्ता', 'ಕೋಫ್ತಾ'],
  Korma: ['कोरमा', 'ಕೋರ್ಮಾ'], Saag: ['साग', 'ಸಾಗ್'], Methi: ['मेथी', 'ಮೆಂತ್ಯ'],
  Chana: ['चना', 'ಕಡಲೆ'], Rajma: ['राजमा', 'ರಾಜ್ಮಾ'], Sambar: ['सांबार', 'ಸಾಂಬಾರ್'],
  Chutney: ['चटनी', 'ಚಟ್ನಿ'], Upma: ['उपमा', 'ಉಪ್ಪಿಟ್ಟು'], Vada: ['वड़ा', 'ವಡೆ'],
  Uttapam: ['उत्तपम', 'ಉತ್ತಪ್ಪ'], Rava: ['रवा', 'ರವೆ'], Ragi: ['रागी', 'ರಾಗಿ'],
  Filter_Coffee: ['फिल्टर कॉफ़ी', 'ಫಿಲ್ಟರ್ ಕಾಫಿ'],

  /* beverages */
  Tea: ['चाय', 'ಚಹಾ'], Coffee: ['कॉफ़ी', 'ಕಾಫಿ'], Milk: ['दूध', 'ಹಾಲು'],
  Flavoured: ['फ्लेवर्ड', 'ಫ್ಲೇವರ್ಡ್'], Horlicks: ['हॉर्लिक्स', 'ಹಾರ್ಲಿಕ್ಸ್'],
  Boost: ['बूस्ट', 'ಬೂಸ್ಟ್'], Badam: ['बादाम', 'ಬಾದಾಮಿ'], Chocolate: ['चॉकलेट', 'ಚಾಕೊಲೇಟ್'],
  Ginger: ['अदरक', 'ಶುಂಠಿ'], Regular: ['रेगुलर', 'ರೆಗ್ಯುಲರ್'], Filter: ['फिल्टर', 'ಫಿಲ್ಟರ್'],
  Buttermilk: ['छाछ', 'ಮಜ್ಜಿಗೆ'], Lassi: ['लस्सी', 'ಲಸ್ಸಿ'], Salted: ['नमकीन', 'ಉಪ್ಪು'],
  Jaljeera: ['जलजीरा', 'ಜಲ್ಜೀರ'], Lime: ['नींबू', 'ನಿಂಬೆ'], Soda: ['सोडा', 'ಸೋಡಾ'],
  Juice: ['जूस', 'ಜ್ಯೂಸ್'], Mojito: ['मोहितो', 'ಮೊಹಿಟೊ'], Virgin: ['वर्जिन', 'ವರ್ಜಿನ್'],
  Mint: ['पुदीना', 'ಪುದೀನ'], Milkshake: ['मिल्कशेक', 'ಮಿಲ್ಕ್‌ಶೇಕ್'], Oreo: ['ओरियो', 'ಓರಿಯೊ'],
  Cold: ['कोल्ड', 'ಕೋಲ್ಡ್'], Can: ['कैन', 'ಕ್ಯಾನ್'], Mineral: ['मिनरल', 'ಮಿನರಲ್'],
  Water: ['पानी', 'ನೀರು'], Drink: ['ड्रिंक', 'ಡ್ರಿಂಕ್'], Soft: ['सॉफ्ट', 'ಸಾಫ್ಟ್'],

  /* fruit */
  Fruit: ['फल', 'ಹಣ್ಣು'], Watermelon: ['तरबूज', 'ಕಲ್ಲಂಗಡಿ'], Pineapple: ['अनानास', 'ಅನಾನಸ್'],
  Muskmelon: ['खरबूजा', 'ಕರ್ಬೂಜ'], Papaya: ['पपीता', 'ಪಪ್ಪಾಯಿ'], Orange: ['संतरा', 'ಕಿತ್ತಳೆ'],
  Apple: ['सेब', 'ಸೇಬು'], Pomegranate: ['अनार', 'ದಾಳಿಂಬೆ'], Banana: ['केला', 'ಬಾಳೆಹಣ್ಣು'],

  /* sweets and extras */
  Ice: ['आइस', 'ಐಸ್'], Gulab: ['गुलाब', 'ಗುಲಾಬ್'], Jamun: ['जामुन', 'ಜಾಮೂನ್'],
  Gajar: ['गाजर', 'ಕ್ಯಾರೆಟ್'], Ka: ['का', 'ಕಾ'], Halwa: ['हलवा', 'ಹಲ್ವಾ'],
  Vanilla: ['वनीला', 'ವೆನಿಲ್ಲಾ'], Strawberry: ['स्ट्रॉबेरी', 'ಸ್ಟ್ರಾಬೆರಿ'],
  Scotch: ['स्कॉच', 'ಸ್ಕಾಚ್'], Current: ['करंट', 'ಕರಂಟ್'], Sauce: ['सॉस', 'ಸಾಸ್'],
  Mayonnaise: ['मेयोनीज़', 'ಮಯೊನೈಸ್'], Biscuit: ['बिस्कुट', 'ಬಿಸ್ಕತ್ತು'],

  /* connective words and section names */
  To: ['टू', 'ಟು'], Order: ['ऑर्डर', 'ಆರ್ಡರ್'], Of: ['ऑफ', 'ಆಫ್'],
  Non: ['नॉन', 'ನಾನ್'], With: ['विद', 'ಜೊತೆ'], Indian: ['इंडियन', 'ಇಂಡಿಯನ್'],
  Main: ['मेन', 'ಮೇನ್'], Course: ['कोर्स', 'ಕೋರ್ಸ್'], Starters: ['स्टार्टर', 'ಸ್ಟಾರ್ಟರ್'],
  Add: ['ऐड', 'ಆಡ್'], "On's": ['ऑन्स', 'ಆನ್ಸ್'], Hunger: ['हंगर', 'ಹಂಗರ್'],
  House: ['हाउस', 'ಹೌಸ್'], Breakfast: ['नाश्ता', 'ಬೆಳಗಿನ ಉಪಾಹಾರ'],
  Beverages: ['पेय', 'ಪಾನೀಯ'], Salads: ['सलाद', 'ಸಲಾಡ್'], Snacks: ['स्नैक्स', 'ಸ್ನ್ಯಾಕ್ಸ್'],
  Accompaniments: ['साथ में', 'ಜೊತೆಗೆ'], Refreshments: ['ठंडा', 'ತಂಪು ಪಾನೀಯ'],
  Dessert: ['मिठाई', 'ಸಿಹಿ'], Desserts: ['मिठाई', 'ಸಿಹಿತಿಂಡಿ'],
};

/** Dishes where stitching the words together produces something nobody says. */
const OVERRIDES = {
  'Curd Rice': ['दही चावल', 'ಮೊಸರನ್ನ'],
  'Ghee Rice': ['घी चावल', 'ತುಪ್ಪದ ಅನ್ನ'],
  'Steam Rice Basmati': ['बासमती चावल', 'ಬಾಸ್ಮತಿ ಅನ್ನ'],
  'Jeera Rice': ['जीरा चावल', 'ಜೀರಿಗೆ ಅನ್ನ'],
  'Idly Wada': ['इडली वड़ा', 'ಇಡ್ಲಿ ವಡೆ'],
  'Poori Bhaji': ['पूरी भाजी', 'ಪೂರಿ ಭಾಜಿ'],
  'Masala Dosa': ['मसाला दोसा', 'ಮಸಾಲ ದೋಸೆ'],
  'Plain Dosa': ['सादा दोसा', 'ಸಾದಾ ದೋಸೆ'],
  'Set Dosa': ['सेट दोसा', 'ಸೆಟ್ ದೋಸೆ'],
  'Kesari Bath': ['केसरी बाथ', 'ಕೇಸರಿ ಬಾತ್'],
  'Cut Fruit': ['कटे फल', 'ಹಣ್ಣಿನ ತುಂಡುಗಳು'],
  'Mineral Water': ['मिनरल वाटर', 'ಕುಡಿಯುವ ನೀರು'],
  'Green Salad': ['हरा सलाद', 'ಹಸಿರು ಸಲಾಡ್'],
  'Masala Papad': ['मसाला पापड़', 'ಮಸಾಲ ಹಪ್ಪಳ'],
  'Roasted Papad': ['भुना पापड़', 'ಸುಟ್ಟ ಹಪ್ಪಳ'],
  'Liquid Sky Combo Meals': ['हंगर हाउस कॉम्बो मील्स', 'ಹಂಗರ್ ಹೌಸ್ ಕಾಂಬೊ ಮೀಲ್ಸ್'],
  'Indian Bread': ['रोटी', 'ರೊಟ್ಟಿ'],
  'Hot Beverages': ['गरम पेय', 'ಬಿಸಿ ಪಾನೀಯ'],
  'Veg Main Course': ['शाकाहारी मुख्य', 'ಸಸ್ಯಾಹಾರಿ ಮುಖ್ಯ ಊಟ'],
  'Non Veg Main Course': ['मांसाहारी मुख्य', 'ಮಾಂಸಾಹಾರಿ ಮುಖ್ಯ ಊಟ'],
  'Veg Starters': ['शाकाहारी स्टार्टर', 'ಸಸ್ಯಾಹಾರಿ ಸ್ಟಾರ್ಟರ್'],
  'Non Veg Starters': ['मांसाहारी स्टार्टर', 'ಮಾಂಸಾಹಾರಿ ಸ್ಟಾರ್ಟರ್'],
  'Snacks & Accompaniments': ['स्नैक्स और साथ', 'ಸ್ನ್ಯಾಕ್ಸ್ ಮತ್ತು ಜೊತೆಗೆ'],
  // "To Order" is a kitchen instruction, not part of the dish's name.
  'Egg To Order — Boiled': ['उबला अंडा', 'ಬೇಯಿಸಿದ ಮೊಟ್ಟೆ'],
  'Egg To Order — Half Boiled': ['हाफ उबला अंडा', 'ಅರ್ಧ ಬೇಯಿಸಿದ ಮೊಟ್ಟೆ'],
  'Egg To Order — Half Fry': ['हाफ फ्राई अंडा', 'ಹಾಫ್ ಫ್ರೈ ಮೊಟ್ಟೆ'],
  'Drums Of Heaven': ['ड्रम्स ऑफ हेवन', 'ಡ್ರಮ್ಸ್ ಆಫ್ ಹೆವನ್'],
  'Bread Omlet': ['ब्रेड ऑमलेट', 'ಬ್ರೆಡ್ ಆಮ್ಲೆಟ್'],
  'Bread Toast': ['ब्रेड टोस्ट', 'ಬ್ರೆಡ್ ಟೋಸ್ಟ್'],
  'Soft Drink Can': ['सॉफ्ट ड्रिंक', 'ಸಾಫ್ಟ್ ಡ್ರಿಂಕ್'],
  'Rice & Noodles — Veg': ['चावल और नूडल्स — वेज', 'ಅನ್ನ ಮತ್ತು ನೂಡಲ್ಸ್ — ವೆಜ್'],
  'Rice & Noodles — Non Veg': ['चावल और नूडल्स — नॉन वेज', 'ಅನ್ನ ಮತ್ತು ನೂಡಲ್ಸ್ — ನಾನ್ ವೆಜ್'],
  "Add-On's": ['साथ में', 'ಜೊತೆಗೆ'],
  Soup: ['सूप', 'ಸೂಪ್'],
  Dal: ['दाल', 'ಬೇಳೆ'],
};

const LANGS = ['en', 'hi', 'kn'];
const INDEX = { hi: 0, kn: 1 };

// Split on whitespace but keep the punctuation that structures a dish name.
const SPLIT = /(\s+|—|\/|&|\(|\)|,)/;

/**
 * Returns the name in `lang`, or null when nothing is known — the caller then
 * shows the English, which is always right even if it is not translated.
 */
/**
 * Names that stay in Latin script on purpose.
 *
 * A bottle says "Bacardi" and a Hindi menu still says Bacardi — printing
 * बकार्डी would be us inventing a spelling nobody asked for. Same for the
 * cocktail list: "Bloody Mary" is the drink's name, not a description.
 *
 * The point of listing them is not the rendering — an unknown word was
 * already left alone — it is that a name made ENTIRELY of brand words used
 * to translate to nothing at all, so 48 of this menu's lines had no Hindi
 * or Kannada name whatsoever. A recognised brand now counts as handled.
 */
const PROPER = new Set([
  // whisky, rum, vodka, gin, brandy
  'Teacher\'s', 'Chivas', 'Regal', 'Jack', 'Daniels', 'Jim', 'Beam', 'Highland',
  'Pipers', 'VAT', 'Vat', 'Blenders', 'Pride', 'Signature', 'Royal', 'Challenge', 'Stag',
  'Rare', 'MC', 'No.1', 'Morpheus', 'Courrier', 'Napoleon', 'Old', 'Monk',
  'Bacardi', 'Smirnoff', 'Jagermeister', 'Desmondji', 'Magnum',
  // beer, wine, coolers
  'Kingfisher', 'Budweiser', 'Carlsberg', 'Tuborg', 'Corona', 'Breezer',
  'Sula', 'Cellier', 'Elephant', 'Label',
  // cocktails, which are proper names too
  'Bull', 'Frog', 'Jager', 'Bomb', 'Screw', 'Driver', 'Cosmopolitan',
  'Bloody', 'Mary', 'Mojito', 'Margarita', 'Daiquiri',
  // units
  'ml', 'Plus', 'Flavors',
]);

function translateName(name, lang) {
  if (lang === 'en' || !INDEX.hasOwnProperty(lang)) return null;
  const i = INDEX[lang];

  const override = OVERRIDES[name];
  if (override) return override[i];

  const parts = String(name).split(SPLIT);
  let hit = false;
  const out = parts.map((p) => {
    if (!p || SPLIT.test(p) && p.trim() === '') return p;
    const term = TERMS[p] || TERMS[p.replace(/[.,]$/, '')];
    if (term) { hit = true; return term[i]; }
    if (PROPER.has(p)) { hit = true; return p; }   // printed as it is on the bottle
    return p;             // numbers like "65", and anything we do not know
  }).join('');

  return hit ? out : null;
}

/** How much of a list of names we can actually render in a language. */
function coverage(names, lang) {
  const done = names.filter((n) => translateName(n, lang)).length;
  return { done, total: names.length, ratio: names.length ? done / names.length : 0 };
}

module.exports = { TERMS, OVERRIDES, LANGS, translateName, coverage };
