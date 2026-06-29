import { BrowserRouter, Routes, Route } from "react-router-dom"
import Home from "./pages/Home"
import CreateLobby from "./pages/CreateLobby"
import JoinLobby from "./pages/JoinLobby"
import Game from "./pages/Game"

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />}/>
        <Route path="/create" element={<CreateLobby />}/>
        <Route path="/join" element={<JoinLobby />}/>
        <Route path="/game/:roomId?" element={<Game />}/>
      </Routes>
    </BrowserRouter>
  )
}