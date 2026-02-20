import { useState } from "react";
import axios from "axios";

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");

  const handleSubmit = async () => {
    const res = await axios.post("/api/generate", {prompt});
    setResponse(res.data.text);
  };

  return(
    <div style = {{padding: "2rem", fontFamily: "monospace"}}>
      <h1>LLM X-ray</h1>
      <textarea rows = {5}
      cols = {60}
      value = {prompt}
      onChange={e => setPrompt(e.target.value)}
      placeholder="Enter a prompt"/>
      <br/>

      <button onClick={handleSubmit}>Analyze</button>
      {response && <pre style = {{marginTop: "1rem"}}>{response}</pre>}
    </div>
  )
}