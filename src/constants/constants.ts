const wordList = ["Bunny", "Sunflower", "Lavender Roses", "Glasses", "Sudoku",
    "Birthday Cake", "Bear", "Bird", "Sunset and Mountain Landscape", "Galaxy", "Cutie", "Tung Tung Tung Sahur", "Tuff signature"
];

function chooseRandomWord(words: string[]): string {
  const randomNumber = Math.floor(Math.random() * words.length)
  return words[randomNumber];
}

const TUTORIAL = [
    {
        title: "HOW TO PLAY",
        description: "DrawOff is a multiplayer drawing game where you VERSE other players in real-time and compete to earn the votes of others."
    },
    {
        title: "1. Join A Lobby",
        description: "Hit 'Play' to join a match or make your own lobby and share the code to invite your friends directly!"
    },
    {
        title: "2. Compete",
        description: "Use your mouse or touch-screen to draw before time expires! Beat your opponent by drawing it better AND faster."
    },
    {
        title: "3. Cast Your Guess",
        description: "Judging? Type your guesses in as fast as possible! Vote on the best drawing w/ others!"
    },
    {
        title: "4. Climb The Leaderboard",
        description: "The player with the highest score at the end of all rounds wins! Judges pick the best drawing :)"
    }
]

export default wordList;
export { TUTORIAL };
export { chooseRandomWord };
