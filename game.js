// Конфигурация Supabase
const SUPABASE_URL = 'https://lazsklnncyvqmmwkbzoj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhenNrbG5uY3l2cW1td2tiem9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2NTI4MTksImV4cCI6MjA3OTIyODgxOX0.XzMQCCleyEqie5Bl3of0Q_SeXMSBkCKhuLJ8CQsuy5w';

// Инициализация Supabase клиента
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentGameId = null;
let playerId = null;
let isPlayer1 = false;
let currentGameState = null;
let gameChannel = null;

// Инициализация игры
function init() {
    playerId = generatePlayerId();
    console.log('Player ID:', playerId);
    createCoordinateGrids();
    showSection('lobby');
}

// Показать определенную секцию
function showSection(sectionName) {
    document.querySelectorAll('.game-section').forEach(section => {
        section.style.display = 'none';
    });
    document.getElementById(sectionName).style.display = 'block';
}

// Создание координатных сеток
function createCoordinateGrids() {
    const letters = ['', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    const numbers = ['', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    
    // Для игровой доски
    const playerCoords = document.getElementById('playerCoords');
    const enemyCoords = document.getElementById('enemyCoords');
    
    playerCoords.innerHTML = '';
    enemyCoords.innerHTML = '';
    
    // Заполняем координаты
    for (let row = 0; row < 11; row++) {
        for (let col = 0; col < 11; col++) {
            const coordCell = document.createElement('div');
            coordCell.className = 'coord-cell';
            
            if (row === 0 && col > 0) {
                coordCell.textContent = numbers[col];
            } else if (col === 0 && row > 0) {
                coordCell.textContent = letters[row];
            }
            
            playerCoords.appendChild(coordCell.cloneNode(true));
            enemyCoords.appendChild(coordCell.cloneNode(true));
        }
    }
}

// Создание новой игры
async function createGame() {
    try {
        document.getElementById('createBtn').disabled = true;
        document.getElementById('createBtn').textContent = 'Создание...';
        
        const gameId = generateGameCode();
        const ships = generateShips();
        
        console.log('Creating game with ID:', gameId);
        
        const { data, error } = await supabaseClient
            .from('games')
            .insert([
                { 
                    id: gameId,
                    player1_id: playerId,
                    player1_board: ships,
                    current_turn: playerId,
                    status: 'waiting'
                }
            ])
            .select();

        if (error) {
            throw new Error('Ошибка создания игры: ' + error.message);
        }

        currentGameId = gameId;
        isPlayer1 = true;
        
        showGameScreen();
        renderBoard(ships, 'playerBoard', false);
        renderBoard([], 'enemyBoard', true);
        updateStatus('Ожидаем второго игрока...');
        
        // Показываем код игры
        document.getElementById('gameCodeDisplay').style.display = 'inline-block';
        document.getElementById('codeValue').textContent = gameId;
        document.getElementById('codeValue').classList.add('pulse');
        
    } catch (error) {
        console.error('Exception in createGame:', error);
        alert(error.message);
    } finally {
        document.getElementById('createBtn').disabled = false;
        document.getElementById('createBtn').textContent = 'Создать новую игру';
    }
}

// Присоединение к игре
async function joinGame() {
    try {
        const gameCode = document.getElementById('gameCode').value.trim().toUpperCase();
        
        if (!gameCode) {
            alert('Введите код игры');
            return;
        }
        
        document.getElementById('joinBtn').disabled = true;
        document.getElementById('joinBtn').textContent = 'Присоединение...';
        
        console.log('Joining game:', gameCode);
        
        const { data, error } = await supabaseClient
            .from('games')
            .select('*')
            .eq('id', gameCode)
            .eq('status', 'waiting')
            .single();

        if (error || !data) {
            throw new Error('Игра не найдена или уже началась');
        }

        const ships = generateShips();
        
        const { error: updateError } = await supabaseClient
            .from('games')
            .update({
                player2_id: playerId,
                player2_board: ships,
                status: 'playing'
            })
            .eq('id', gameCode);

        if (updateError) {
            throw new Error('Ошибка присоединения к игре: ' + updateError.message);
        }

        currentGameId = gameCode;
        isPlayer1 = false;
        
        showGameScreen();
        renderBoard(ships, 'playerBoard', false);
        renderBoard([], 'enemyBoard', true);
        updateStatus('Игра началась! Ожидаем ход противника');
        
    } catch (error) {
        console.error('Exception in joinGame:', error);
        alert(error.message);
    } finally {
        document.getElementById('joinBtn').disabled = false;
        document.getElementById('joinBtn').textContent = 'Присоединиться к игре';
    }
}

// Показать игровой экран
function showGameScreen() {
    showSection('game');
    startGameListener();
}

// Слушатель изменений игры
function startGameListener() {
    console.log('Starting game listener for:', currentGameId);
    
    if (gameChannel) {
        supabaseClient.removeChannel(gameChannel);
    }
    
    gameChannel = supabaseClient
        .channel('game_changes')
        .on('postgres_changes', 
            { 
                event: '*', 
                schema: 'public', 
                table: 'games',
                filter: `id=eq.${currentGameId}`
            }, 
            (payload) => {
                console.log('Game update received:', payload);
                handleGameUpdate(payload);
            }
        )
        .subscribe((status) => {
            console.log('Subscription status:', status);
        });
}

// Обработка обновлений игры
async function handleGameUpdate(payload) {
    const game = payload.new;
    currentGameState = game;
    
    if (game.status === 'finished') {
        const isWinner = game.winner === playerId;
        updateStatus(isWinner ? '🎉 Вы победили!' : '💥 Вы проиграли!');
        highlightDestroyedShips();
        return;
    }

    // Обновляем статус хода
    if (game.current_turn === playerId) {
        updateStatus('🎯 Ваш ход! Выберите клетку для выстрела');
        enableEnemyBoard();
    } else {
        updateStatus('⏳ Ход противника... Ожидайте');
        disableEnemyBoard();
    }

    // Обновление доски противника на основе наших выстрелов
    const myShots = isPlayer1 ? game.player1_shots : game.player2_shots;
    renderEnemyBoard(myShots);
    
    // Обновление нашей доски на основе выстрелов противника
    const enemyShots = isPlayer1 ? game.player2_shots : game.player1_shots;
    renderPlayerBoard(enemyShots, isPlayer1 ? game.player1_board : game.player2_board);
    
    // Подсветка уничтоженных кораблей
    highlightDestroyedShips();
}

// Включение доски противника для хода
function enableEnemyBoard() {
    const enemyCells = document.querySelectorAll('#enemyBoard .cell');
    enemyCells.forEach(cell => {
        const x = parseInt(cell.dataset.x);
        const y = parseInt(cell.dataset.y);
        
        // Проверяем, не стреляли ли уже в эту клетку
        const myShots = isPlayer1 ? currentGameState.player1_shots : currentGameState.player2_shots;
        const alreadyShot = myShots && myShots.some(shot => shot.x === x && shot.y === y);
        
        if (!alreadyShot) {
            cell.style.cursor = 'pointer';
            cell.onclick = () => makeShot(x, y);
        } else {
            cell.style.cursor = 'not-allowed';
            cell.onclick = null;
        }
    });
}

// Отключение доски противника
function disableEnemyBoard() {
    const enemyCells = document.querySelectorAll('#enemyBoard .cell');
    enemyCells.forEach(cell => {
        cell.style.cursor = 'not-allowed';
        cell.onclick = null;
    });
}

// Выстрел
async function makeShot(x, y) {
    try {
        console.log('Making shot at:', x, y);
        
        if (!currentGameState || currentGameState.current_turn !== playerId) {
            alert('Не ваш ход!');
            return;
        }

        const shots = isPlayer1 ? currentGameState.player1_shots : currentGameState.player2_shots;
        
        // Проверяем, не стреляли ли уже сюда
        if (shots && shots.some(shot => shot.x === x && shot.y === y)) {
            alert('Уже стреляли сюда!');
            return;
        }

        const enemyBoard = isPlayer1 ? currentGameState.player2_board : currentGameState.player1_board;
        const isHit = enemyBoard.some(ship => 
            ship.positions.some(pos => pos.x === x && pos.y === y)
        );

        const newShots = [...(shots || []), { x, y, hit: isHit }];
        
        const updateData = {
            [isPlayer1 ? 'player1_shots' : 'player2_shots']: newShots,
            current_turn: isPlayer1 ? currentGameState.player2_id : currentGameState.player1_id
        };

        // Проверка победы
        if (checkWin(newShots, enemyBoard)) {
            updateData.status = 'finished';
            updateData.winner = playerId;
            await updateStats(playerId, true);
            if (isPlayer1 && currentGameState.player2_id) {
                await updateStats(currentGameState.player2_id, false);
            } else if (currentGameState.player1_id) {
                await updateStats(currentGameState.player1_id, false);
            }
        }

        const { error: updateError } = await supabaseClient
            .from('games')
            .update(updateData)
            .eq('id', currentGameId);

        if (updateError) {
            throw new Error('Ошибка выстрела: ' + updateError.message);
        }
        
        // Визуальная обратная связь
        const cell = document.querySelector(`#enemyBoard [data-x="${x}"][data-y="${y}"]`);
        if (cell) {
            cell.classList.add(isHit ? 'hit' : 'miss');
        }
        
    } catch (error) {
        console.error('Exception in makeShot:', error);
        alert(error.message);
    }
}

// Подсветка уничтоженных кораблей
function highlightDestroyedShips() {
    if (!currentGameState) return;
    
    const enemyBoard = isPlayer1 ? currentGameState.player2_board : currentGameState.player1_board;
    const myShots = isPlayer1 ? currentGameState.player1_shots : currentGameState.player2_shots;
    
    if (!enemyBoard || !myShots) return;
    
    enemyBoard.forEach(ship => {
        const isDestroyed = ship.positions.every(pos => 
            myShots.some(shot => shot.x === pos.x && shot.y === pos.y && shot.hit)
        );
        
        if (isDestroyed) {
            ship.positions.forEach(pos => {
                const cell = document.querySelector(`#enemyBoard [data-x="${pos.x}"][data-y="${pos.y}"]`);
                if (cell) {
                    cell.classList.add('ship-destroyed');
                }
            });
        }
    });
}

// Вспомогательные функции
function generatePlayerId() {
    return 'player_' + Math.random().toString(36).substr(2, 9);
}

function generateGameCode() {
    return Math.random().toString(36).substr(2, 6).toUpperCase();
}

function generateShips() {
    const ships = [];
    const sizes = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
    
    sizes.forEach(size => {
        let placed = false;
        let attempts = 0;
        
        while (!placed && attempts < 100) {
            attempts++;
            const horizontal = Math.random() > 0.5;
            const x = Math.floor(Math.random() * (horizontal ? 11 - size : 10));
            const y = Math.floor(Math.random() * (horizontal ? 10 : 11 - size));
            
            const positions = [];
            for (let i = 0; i < size; i++) {
                positions.push({
                    x: horizontal ? x + i : x,
                    y: horizontal ? y : y + i
                });
            }
            
            // Проверка пересечения с другими кораблями
            const intersects = ships.some(ship =>
                ship.positions.some(pos1 =>
                    positions.some(pos2 =>
                        Math.abs(pos1.x - pos2.x) <= 1 && Math.abs(pos1.y - pos2.y) <= 1
                    )
                )
            );
            
            if (!intersects) {
                ships.push({ size, positions, hits: 0 });
                placed = true;
            }
        }
    });
    
    return ships;
}

function renderBoard(ships, boardId, isEnemy) {
    const board = document.getElementById(boardId);
    board.innerHTML = '';
    
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.x = x;
            cell.dataset.y = y;
            
            const hasShip = ships.some(ship =>
                ship.positions.some(pos => pos.x === x && pos.y === y)
            );
            
            if (!isEnemy && hasShip) {
                cell.classList.add('ship');
            }
            
            if (isEnemy) {
                cell.classList.add('enemy-cell', 'hidden');
            }
            
            board.appendChild(cell);
        }
    }
}

function renderEnemyBoard(shots) {
    const board = document.getElementById('enemyBoard');
    
    if (!shots) return;
    
    // Сначала сбрасываем все ячейки
    const cells = board.getElementsByClassName('cell');
    for (let cell of cells) {
        cell.classList.remove('hit', 'miss', 'ship-destroyed');
        cell.classList.add('hidden');
    }
    
    // Затем применяем выстрелы
    shots.forEach(shot => {
        const cell = board.querySelector(`[data-x="${shot.x}"][data-y="${shot.y}"]`);
        if (cell) {
            cell.classList.remove('hidden');
            cell.classList.add(shot.hit ? 'hit' : 'miss');
        }
    });
}

function renderPlayerBoard(shots, ships) {
    const board = document.getElementById('playerBoard');
    
    if (!ships) return;
    
    // Сначала отрисовываем корабли
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            const cell = board.querySelector(`[data-x="${x}"][data-y="${y}"]`);
            if (cell) {
                cell.className = 'cell';
                
                const hasShip = ships.some(ship =>
                    ship.positions.some(pos => pos.x === x && pos.y === y)
                );
                
                if (hasShip) {
                    cell.classList.add('ship');
                }
            }
        }
    }
    
    // Затем отрисовываем выстрелы
    if (shots) {
        shots.forEach(shot => {
            const cell = board.querySelector(`[data-x="${shot.x}"][data-y="${shot.y}"]`);
            if (cell) {
                cell.classList.add(shot.hit ? 'hit' : 'miss');
            }
        });
    }
}

function checkWin(shots, enemyShips) {
    if (!enemyShips || !shots) return false;
    
    return enemyShips.every(ship =>
        ship.positions.every(pos =>
            shots.some(shot => shot.x === pos.x && shot.y === pos.y && shot.hit)
        )
    );
}

async function updateStats(playerId, isWin) {
    try {
        const { data: stats } = await supabaseClient
            .from('player_stats')
            .select('*')
            .eq('player_id', playerId)
            .single();

        const updateData = {
            games_played: (stats?.games_played || 0) + 1,
            games_won: (stats?.games_won || 0) + (isWin ? 1 : 0),
            total_shots: (stats?.total_shots || 0) + 1
        };

        if (stats) {
            await supabaseClient
                .from('player_stats')
                .update(updateData)
                .eq('player_id', playerId);
        } else {
            await supabaseClient
                .from('player_stats')
                .insert([{ player_id: playerId, ...updateData }]);
        }
    } catch (error) {
        console.error('Error updating stats:', error);
    }
}

function updateStatus(message) {
    document.getElementById('status').textContent = message;
}

// Покинуть игру
async function leaveGame() {
    if (confirm('Вы уверены, что хотите покинуть игру?')) {
        if (gameChannel) {
            supabaseClient.removeChannel(gameChannel);
            gameChannel = null;
        }
        
        currentGameId = null;
        currentGameState = null;
        
        showSection('lobby');
        document.getElementById('gameCodeDisplay').style.display = 'none';
        document.getElementById('gameCode').value = '';
    }
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', function() {
    init();
});