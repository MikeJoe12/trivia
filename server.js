const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

let gameState = {
    isActive: false,
    questions: [],
    players: new Map(), // Map to store player connections
    hostConnection: null,
    playersCompleted: new Set(),
    finalResults: [] // To store final results
};

io.on('connection', (socket) => {
    // Host connection
    socket.on('host_connect', () => {
        gameState.hostConnection = socket.id;
        updatePlayerList();
    });

    // Player connection
    socket.on('player_connect', (playerName) => {
        // Ensure the name is unique
        let modifiedName = playerName;
        let counter = 1;
        while (gameState.players.has(modifiedName)) {
            modifiedName = `${playerName}_${counter}`;
            counter++;
        }

        gameState.players.set(modifiedName, {
            id: socket.id,
            answers: [],
            name: modifiedName,
            originalName: playerName
        });
        
        // Send back the possibly modified name
        socket.emit('player_name_confirmed', modifiedName);
        updatePlayerList();
    });

    // Start game
    socket.on('start_game', (questions) => {
        gameState.isActive = true;
        gameState.questions = questions;
        gameState.playersCompleted.clear();
        gameState.finalResults = [];

        // Reset player states
        gameState.players.forEach(player => {
            player.answers = [];
        });

        // Send questions to all players
        gameState.players.forEach((player) => {
            io.to(player.id).emit('game_started', { 
                questions: questions.map(q => ({
                    question: q.question,
                    options: q.options
                }))
            });
        });

        updatePlayerList();
    });

    // Submit answer
    socket.on('submit_answer', (data) => {
        const { playerName, questionIndex, answer } = data;
        const player = Array.from(gameState.players.values())
            .find(p => p.name === playerName);

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
    });

    // End game
    socket.on('end_game', () => {
        endGame();
    });

    // Reset game
    socket.on('reset_game', () => {
        // Disconnect and notify all players
        gameState.players.forEach((player) => {
            io.to(player.id).emit('force_disconnect');
        });

        // Completely reset game state
        gameState = {
            isActive: false,
            questions: [],
            players: new Map(),
            hostConnection: gameState.hostConnection, // Keep host connection
            playersCompleted: new Set(),
            finalResults: []
        };

        // Update host with empty player list
        updatePlayerList();
    });

    // Disconnect handling
    socket.on('disconnect', () => {
        if (socket.id === gameState.hostConnection) {
            gameState.hostConnection = null;
        } else {
            const playerToRemove = Array.from(gameState.players.values())
                .find(p => p.id === socket.id);
            
            if (playerToRemove) {
                gameState.players.delete(playerToRemove.name);
                gameState.playersCompleted.delete(playerToRemove.name);
                updatePlayerList();
            }
        }
    });
});

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

    // Broadcast game ended to all players and host
    io.emit('game_ended', { 
        results: gameState.finalResults 
    });
}

function updatePlayerList() {
    if (gameState.hostConnection) {
        const playerList = Array.from(gameState.players.values()).map(player => ({
            name: player.name,
            score: 0 // Always send 0 during gameplay
        }));

        io.to(gameState.hostConnection).emit('player_list', { players: playerList });
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});