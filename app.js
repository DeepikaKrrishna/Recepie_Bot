const API_BASE = "http://127.0.0.1:8000";

// Make marked safer (using basic defaults as loaded via CDN)
marked.setOptions({
  breaks: true,
  gfm: true
});

function toggleMode() {
  document.body.classList.toggle('dark-mode');
  const btn = document.getElementById('modeToggle');
  btn.innerHTML = document.body.classList.contains('dark-mode') ? '☀ Light Mode' : '🌙 Dark Mode';
}

function startListening() {
  const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
  recognition.lang = 'en-US';
  recognition.start();
  recognition.onresult = e => {
    document.getElementById('userInput').value = e.results[0][0].transcript;
  };
  recognition.onerror = e => alert('Voice error: ' + e.error);
}

async function getSuggestions() {
  const input = document.getElementById('userInput').value.trim();
  const suggestionsDiv = document.getElementById('suggestions');
  const responseDiv = document.getElementById('response');

  if (!input) {
    alert("Please enter ingredients.");
    return;
  }

  // Show skeletons
  suggestionsDiv.style.display = 'block';
  suggestionsDiv.innerHTML = `
    <div class="skeleton title"></div>
    <div class="skeleton line"></div>
    <div class="skeleton line short"></div>
  `;
  responseDiv.style.display = 'none';

  try {
    const res = await fetch(`${API_BASE}/suggest?ingredients=${encodeURIComponent(input)}`);
    const data = await res.json();

    suggestionsDiv.innerHTML = '<h3 style="margin-bottom: 15px;">✨ Fast Suggestions</h3>';

    if (data.suggestions && data.suggestions.length > 0) {
      data.suggestions.forEach(title => {
        const link = document.createElement('a');
        link.className = 'recipe-link';
        link.textContent = title;
        link.onclick = (e) => {
          e.preventDefault();
          generateRecipe(title);
        };
        suggestionsDiv.appendChild(link);
      });
    } else {
      suggestionsDiv.innerHTML += '<p>No quick matches found. Tell the AI below if you want something custom!</p>';
    }

    // Add a custom generate button
    const customBtn = document.createElement('button');
    customBtn.className = 'btn-custom';
    customBtn.style.marginTop = '15px';
    customBtn.textContent = 'Generate Custom Recipe 🤖';
    customBtn.onclick = () => generateRecipe(input);
    suggestionsDiv.appendChild(customBtn);

  } catch (err) {
    console.error(err);
    suggestionsDiv.innerHTML = '<p>Error fetching suggestions. Make sure backend is running.</p>';
  }
}

async function generateRecipe(title) {
  const responseDiv = document.getElementById('response');
  responseDiv.style.display = 'block';
  responseDiv.innerHTML = `
    <h3>👨‍🍳 Generating Recipe...</h3>
    <div class="skeleton line"></div>
    <div class="skeleton line"></div>
    <div class="skeleton line short"></div>
  `;

  try {
    const res = await fetch(`${API_BASE}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title })
    });

    if (!res.ok) throw new Error("API failed");

    responseDiv.innerHTML = '<div class="markdown-body" id="streamContent"></div>';
    const streamContentContainer = document.getElementById('streamContent');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accumulatedText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.substring(6);
          try {
            const dataObj = JSON.parse(dataStr);
            if (dataObj.text) {
              accumulatedText += dataObj.text;
              streamContentContainer.innerHTML = marked.parse(accumulatedText);
            }
          } catch (e) {
            // Ignore parse errors from partial chunks
          }
        }
      }
    }
  } catch (err) {
    console.error(err);
    responseDiv.innerHTML = '<p style="color: red;">Error generating recipe. Please try again.</p>';
  }
}

async function askQuestion() {
  const qInput = document.getElementById('questionInput').value.trim();
  const qaDiv = document.getElementById('qaResponse');

  if (!qInput) return;

  qaDiv.style.display = 'block';
  qaDiv.innerHTML = '<div class="skeleton line"></div><div class="skeleton line short"></div>';

  try {
    const res = await fetch(`${API_BASE}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: qInput })
    });
    const data = await res.json();
    qaDiv.className = "response-box markdown-body";
    qaDiv.innerHTML = `<p><strong>Answer:</strong></p>${marked.parse(data.answer)}`;
  } catch (err) {
    qaDiv.innerHTML = "Error answering question.";
  }
}

// Initial mode setup
if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
  document.body.classList.add('dark-mode');
  document.getElementById('modeToggle').innerHTML = '☀ Light Mode';
}
function getSuggestions() {
  const input = document.getElementById("userInput").value;

  if (!input) {
    alert("Please enter ingredients!");
    return;
  }

  document.getElementById("suggestions").innerHTML = "Loading...";

  fetch("http://127.0.0.1:5000/get-recipes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ingredients: input })
  })
    .then(res => res.json())
    .then(data => {
      document.getElementById("suggestions").innerHTML = data.recipes;
    })
    .catch(err => {
      console.error(err);
      document.getElementById("suggestions").innerHTML = "Error fetching recipes";
    });
}
function askQuestion() {
  const question = document.getElementById("questionInput").value;

  if (!question) {
    alert("Ask something!");
    return;
  }

  document.getElementById("qaResponse").innerHTML = "Thinking...";

  fetch("http://127.0.0.1:5000/ask", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ question: question })
  })
    .then(res => res.json())
    .then(data => {
      document.getElementById("qaResponse").innerHTML = data.answer;
    })
    .catch(err => {
      console.error(err);
      document.getElementById("qaResponse").innerHTML = "Error";
    });
}
function startListening() {
  alert("Voice feature coming soon 🎤");
}
function getSuggestions() {
  const input = document.getElementById("userInput").value;

  if (!input) {
    alert("Enter something!");
    return;
  }

  document.getElementById("suggestions").innerHTML =
    "🍳 Recipes for: " + input;
}

function askQuestion() {
  const question = document.getElementById("questionInput").value;

  if (!question) {
    alert("Ask something!");
    return;
  }

  document.getElementById("qaResponse").innerHTML =
    "🤖 Answer: " + question;
}
