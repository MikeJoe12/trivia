// server-logged-in-check.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

let gameState = {
    isActive: false,
    questions: [],
    players: new Map(), // Map to store player connections
    hostConnection: null,
    playersCompleted: new Set(),
    finalResults: [] // To store final results
};

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        handleMessage(ws, data);
    });

    ws.on('close', () => {
        handleDisconnect(ws);
    });
});

function handleMessage(ws, data) {
    switch (data.type) {
        case 'host_connect':
            handleHostConnect(ws);
            break;

        case 'player_connect':
            handlePlayerConnect(ws, data.name);
            break;
		case 'reset_game':
            resetGameState();
            break;	

        case 'start_game':
            handleStartGame(data.questions);
            break;

        case 'submit_answer':
            handlePlayerAnswer(data.playerName, data.questionIndex, data.answer);
            break;

        case 'end_game':
            endGame();
            break;
    }
}

function handleHostConnect(ws) {
    gameState.hostConnection = ws;
    ws.isHost = true;
    broadcastPlayerList();
}

function resetGameState() {
    // Store old player connections to force disconnect them
    const playerConnections = Array.from(gameState.players.values())
        .map(player => player.connection);

    gameState = {
        isActive: false,
        questions: [],
        players: new Map(),
        hostConnection: gameState.hostConnection,
        playersCompleted: new Set(),
        finalResults: []
    };

    // Force disconnect all players
    playerConnections.forEach(connection => {
        if (connection && connection.readyState === WebSocket.OPEN) {
            connection.send(JSON.stringify({ type: 'force_disconnect' }));
            connection.close();
        }
    });

    // Update host with empty player list
    broadcastPlayerList();
}

function handlePlayerConnect(ws, playerName) {
    if (!gameState.players.has(playerName)) {
        gameState.players.set(playerName, {
            connection: ws,
            answers: [],
            name: playerName
        });
        ws.playerName = playerName;
        broadcastPlayerList();
    }
}

function handleStartGame(questions) {
    gameState.isActive = true;
    gameState.questions = questions;
    gameState.playersCompleted.clear();
    gameState.finalResults = [];

    // Reset player states
    gameState.players.forEach(player => {
        player.answers = [];
    });

    // Send questions only to logged-in players
    wss.clients.forEach(client => {
        if (!client.isHost && client.readyState === WebSocket.OPEN && client.playerName) {
            sendQuestionsToPlayer(client);
        }
    });

    broadcastPlayerList();
}

function sendQuestionsToPlayer(ws) {
    // Send stripped questions (without correct answers)
    const playerQuestions = gameState.questions.map(q => ({
        question: q.question,
        options: q.options
    }));

    sendToClient(ws, {
        type: 'game_started',
        questions: playerQuestions
    });
}

function handlePlayerAnswer(playerName, questionIndex, answer) {
    const player = gameState.players.get(playerName);
    if (player && gameState.isActive) {
        // Store the answer
        player.answers[questionIndex] = answer;

        // Check if player has answered all questions
        if (player.answers.length === gameState.questions.length) {
            gameState.playersCompleted.add(playerName);
            
            // Check if all players have completed
            if (gameState.playersCompleted.size === gameState.players.size) {
                endGame();
            }
        }
    }
}

function endGame() {
    gameState.isActive = false;
    
    // Calculate final scores
    gameState.finalResults = Array.from(gameState.players.values()).map(player => ({
        name: player.name,
        score: player.answers.reduce((score, ans, idx) => {
            return score + (ans === gameState.questions[idx].correct_answer ? 1 : 0);
        }, 0),
        answers: player.answers
    }));

    broadcast({
        type: 'game_ended',
        results: gameState.finalResults
    });
}

function handleDisconnect(ws) {
    if (ws.isHost) {
        gameState.hostConnection = null;
    } else if (ws.playerName) {
        gameState.players.delete(ws.playerName);
        gameState.playersCompleted.delete(ws.playerName);
        broadcastPlayerList();
    }
}

function sendToClient(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            sendToClient(client, data);
        }
    });
}

function broadcastPlayerList() {
    if (gameState.hostConnection) {
        const playerList = Array.from(gameState.players.values()).map(player => ({
            name: player.name,
            score: 0 // Always send 0 during gameplay
        }));

        sendToClient(gameState.hostConnection, {
            type: 'player_list',
            players: playerList
        });
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});