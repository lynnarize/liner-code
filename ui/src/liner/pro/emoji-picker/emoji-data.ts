/** A compact emoji set: the ones people reach for, with names to search by. */
export type Emoji = { e: string; n: string };
export type EmojiGroup = { id: string; label: string; items: Emoji[] };

const g = (id: string, label: string, list: string): EmojiGroup => ({
  id,
  label,
  items: list
    .trim()
    .split("\n")
    .map((l) => {
      const [e, ...n] = l.trim().split(" ");
      return { e, n: n.join(" ") };
    }),
});

export const emojiGroups: EmojiGroup[] = [
  g("smileys", "Smileys", `
😀 grinning face
😃 big smile
😄 smile with eyes
😁 beaming
😆 laughing
🥹 holding back tears
😅 sweat smile
😂 tears of joy
🤣 rolling on the floor
🙂 slight smile
🙃 upside down
😉 wink
😊 blush
😇 halo
🥰 hearts
😍 heart eyes
🤩 star struck
😘 kiss
😋 yum
😛 tongue
🤔 thinking
🫡 salute
🤗 hug
🤭 hand over mouth
🫢 gasp
🤫 shush
😐 neutral
😑 expressionless
😶 no mouth
🫠 melting
😏 smirk
😒 unamused
🙄 eye roll
😬 grimace
😮‍💨 exhale
😌 relieved
😔 pensive
😴 sleeping
🤒 thermometer sick
🤯 mind blown
🥳 party
😎 cool sunglasses
🤓 nerd
🧐 monocle
😕 confused
😟 worried
😮 open mouth
😲 astonished
🥺 pleading
😢 crying
😭 sobbing
😤 triumph
😡 angry
🤬 swearing
💀 skull
👻 ghost
🤖 robot
`),
  g("people", "People", `
👋 wave
🤚 raised back of hand
✋ raised hand
👌 ok
🤌 pinched fingers
✌️ victory
🤞 crossed fingers
🫶 heart hands
👍 thumbs up
👎 thumbs down
👏 clap
🙌 raising hands
🙏 folded hands thanks
💪 flexed biceps
🫵 pointing at you
👉 point right
👀 eyes
🧠 brain
🫂 people hugging
🧑‍💻 technologist
🧑‍🎨 artist
🧑‍🚀 astronaut
🧑‍🍳 cook
🧑‍🏫 teacher
`),
  g("nature", "Nature", `
🐶 dog
🐱 cat
🦊 fox
🐻 bear
🐼 panda
🐨 koala
🦁 lion
🐸 frog
🐙 octopus
🦋 butterfly
🐝 bee
🐢 turtle
🌵 cactus
🌲 evergreen tree
🌿 herb
🍀 four leaf clover
🌸 cherry blossom
🌻 sunflower
🌙 moon
⭐ star
🌈 rainbow
☀️ sun
⛅ partly cloudy
🌧️ rain
❄️ snowflake
🔥 fire
🌊 wave water
`),
  g("food", "Food", `
🍎 apple
🍋 lemon
🍓 strawberry
🍑 peach
🥑 avocado
🍅 tomato
🌽 corn
🥐 croissant
🍞 bread
🧀 cheese
🍕 pizza
🍔 burger
🌮 taco
🍜 noodles
🍣 sushi
🍩 doughnut
🍪 cookie
🎂 birthday cake
🍫 chocolate
☕ coffee
🍵 tea
🧋 bubble tea
🍷 wine
🍻 cheers beers
`),
  g("activity", "Activity", `
⚽ soccer
🏀 basketball
🎾 tennis
🏓 ping pong
🎯 bullseye
🎮 video game
🎲 dice
🧩 puzzle
🎨 palette art
🎬 clapper film
🎧 headphones
🎸 guitar
🎹 piano
🏆 trophy
🥇 gold medal
🎉 party popper
🎊 confetti
🎁 gift
🎈 balloon
`),
  g("travel", "Travel", `
🚗 car
🚕 taxi
🚌 bus
🚲 bicycle
🛴 scooter
✈️ airplane
🚀 rocket
🛸 flying saucer
🚢 ship
🗺️ map
🧭 compass
🏔️ mountain
🏖️ beach
🏝️ island
🏕️ camping
🏠 house
🏢 office
🗽 statue of liberty
🌉 bridge at night
`),
  g("objects", "Objects", `
💡 light bulb
📌 pin
📎 paperclip
✏️ pencil
📝 memo
📚 books
📅 calendar
📈 chart up
📉 chart down
📊 bar chart
💼 briefcase
💻 laptop
⌨️ keyboard
🖥️ desktop
📱 phone
📷 camera
🔋 battery
🔌 plug
🔒 lock
🔑 key
🛠️ tools
⚙️ gear
🧪 test tube
💰 money bag
✉️ envelope
📦 package
`),
  g("symbols", "Symbols", `
❤️ red heart
🧡 orange heart
💛 yellow heart
💚 green heart
💙 blue heart
💜 purple heart
🖤 black heart
🤍 white heart
💔 broken heart
✨ sparkles
⚡ lightning
💯 hundred
✅ check mark
❌ cross mark
⚠️ warning
❓ question
❗ exclamation
➕ plus
➖ minus
🔁 repeat
♻️ recycle
🔔 bell
💬 speech bubble
👁️‍🗨️ eye in bubble
🆕 new
🆗 ok button
`),
];
