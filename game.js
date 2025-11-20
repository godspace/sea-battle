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
let canShoot = false;

// Инициализация игры
function init() {
    playerId = generatePlayerId();
    console.log('Player ID:', playerId);
    createCoordinateGrids();
    showSection('lobby');
}

// Создание координатных сеток
function createCoordinateGrids() {
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    const numbers = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    
    // Для игровой доски
    const playerCoords = document.getElementById('playerCoords');
    const enemyCoords = document.getElementById('enemyCoords');
    
    playerCoords.innerHTML = '';
    enemyCoords.innerHTML = '';
    
    // Заполняем координаты (11x11 grid)
    for (let row = 0; row < 11; row++) {
        for (let col = 0; col < 11; col++) {
            const coordCell = document.createElement('div');
            coordCell.className = 'coord-cell';
            
            if (row === 0 && col > 0) {
                // Верхние координаты (буквы)
                coordCell.textContent = letters[col - 1];
            } else if (col === 0 && row > 0) {
                // Боковые координаты (цифры)
                coordCell.textContent = numbers[row - 1];
            } else if (row === 0 && col === 0) {
                // Пустой угол
                coordCell.textContent = '';
            }
            
            playerCoords.appendChild(coordCell);
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
        currentGameState = data[0];
        
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
        
        // Сначала находим игру
        const { data: gameData, error } = await supabaseClient
            .from('games')
            .select('*')
            .eq('id', gameCode)
            .eq('status', 'waiting')
            .single();

        if (error || !gameData) {
            throw new Error('Игра не найдена или уже началась');
        }

        const ships = generateShips();
        
        // Присоединяемся к игре
        const { data: updatedGame, error: updateError } = await supabaseClient
            .from('games')
            .update({
                player2_id: playerId,
                player2_board: ships,
                status: 'playing'
            })
            .eq('id', gameCode)
            .select()
            .single();

        if (updateError) {
            throw new Error('Ошибка присоединения к игре: ' + updateError.message);
        }

        currentGameId = gameCode;
        isPlayer1 = false;
        currentGameState = updatedGame;
        
        showGameScreen();
        renderBoard(ships, 'playerBoard', false);
        renderBoard([], 'enemyBoard', true);
        
        if (currentGameState.current_turn === playerId) {
            updateStatus('Игра началась! Ваш ход!');
            enableEnemyBoard();
        } else {
            updateStatus('Игра началась! Ход противника...');
            disableEnemyBoard();
        }
        
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
            if (status === 'SUBSCRIBED') {
                console.log('Successfully subscribed to game changes');
            }
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
        disableEnemyBoard();
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
    console.log('Enabling enemy board for shooting');
    canShoot = true;
    
    const enemyCells = document.querySelectorAll('#enemyBoard .cell');
    const myShots = isPlayer1 ? currentGameState.player1_shots : currentGameState.player2_shots;
    
    enemyCells.forEach(cell => {
        const x = parseInt(cell.dataset.x);
        const y = parseInt(cell.dataset.y);
        
        // Проверяем, не стреляли ли уже в эту клетку
        const alreadyShot = myShots && myShots.some(shot => shot.x === x && shot.y === y);
        
        if (!alreadyShot) {
            cell.style.cursor = 'pointer';
            cell.onclick = () => makeShot(x, y);
            cell.classList.add('can-shoot');
        } else {
            cell.style.cursor = 'not-allowed';
            cell.onclick = null;
            cell.classList.remove('can-shoot');
        }
    });
}

// Отключение доски противника
function disableEnemyBoard() {
    console.log('Disabling enemy board');
    canShoot = false;
    
    const enemyCells = document.querySelectorAll('#enemyBoard .cell');
    enemyCells.forEach(cell => {
        cell.style.cursor = 'not-allowed';
        cell.onclick = null;
        cell.classList.remove('can-shoot');
    });
}

// Выстрел
async function makeShot(x, y) {
    try {
        console.log('Making shot at:', x, y);
        
        if (!canShoot) {
            alert('Сейчас не ваш ход!');
            return;
        }
        
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
            cell.classList.remove('can-shoot', 'hidden');
            cell.classList.add(isHit ? 'hit' : 'miss');
            cell.style.cursor = 'default';
            cell.onclick = null;
        }
        
        // Временно блокируем доску до получения обновления
        disableEnemyBoard();
        
    } catch (error) {
        console.error('Exception in makeShot:', error);
        alert(error.message);
    }
}

// Остальные функции остаются без изменений (generateShips, renderBoard, renderEnemyBoard, renderPlayerBoard, checkWin, updateStats, etc.)

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

// Вспомогательные функции (generatePlayerId, generateGameCode, generateShips, etc.) остаются без изменений

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', function() {
    init();
});