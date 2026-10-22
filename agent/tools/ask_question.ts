// Opt-in since eve 0.8x: lets the model ask the user a question with 2–3 options and wait for
// the answer. The chat UI renders these as an interactive card (src/components/eve/InputRequestCard).
import { askQuestion } from "eve/tools/ask_question";

export default askQuestion();
