import { io } from "socket.io-client";

const socket = io("https://ruzzleboard.vercel.app", {
  autoConnect: true,
});

export default socket;
