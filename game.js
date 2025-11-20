// Конфигурация Supabase
const SUPABASE_URL = 'https://lazsklnncyvqmmwkbzoj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhenNrbG5uY3l2cW1td2tiem9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2NTI4MTksImV4cCI6MjA3OTIyODgxOX0.XzMQCCleyEqie5Bl3of0Q_SeXMSBkCKhuLJ8CQsuy5w';

// Инициализация Supabase клиента
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentGameId = null;
let playerId = null;
let isPlayer1 = false;

// Инициализация игры
function init() {
    playerId = generatePlayerId();
    console.log('Player ID:', playerId);
}

// Создание новой игры
async function createGame() {
    const gameId = generateGameCode();
    const ships = generateShips();
    
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
        console.error('Error creating game:', error);
        alert('Ошибка создания игры: ' + error.message);
        return;
    }

    currentGameId = gameId;
    isPlayer1 = true;
    showGame();
    startGameListener();
    renderBoard(ships, 'playerBoard', false);
    renderBoard(createEmptyBoard(), 'enemyBoard', true);
    updateStatus('Ожидаем второго игрока... Код игры: ' + gameId);
}

// Присоединение к игре
async function joinGame() {
    const gameCode = document.getElementById('gameCode').value.trim();
    
    if (!gameCode) {
        alert('Введите код игры');
        return;
    }
    
    const { data, error } = await supabaseClient
        .from('games')
        .select('*')
        .eq('id', gameCode)
        .eq('status', 'waiting')
        .single();

    if (error || !data) {
        alert('Игра не найдена или уже началась');
        return;
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
        console.error('Error joining game:', updateError);
        alert('Ошибка присоединения к игре: ' + updateError.message);
        return;
    }

    currentGameId = gameCode;
    isPlayer1 = false;
    showGame();
    startGameListener();
    renderBoard(ships, 'playerBoard', false);
    renderBoard(createEmptyBoard(), 'enemyBoard', true);
    updateStatus('Игра началась! Ожидаем ход противника');
}

// Слушатель изменений игры
function startGameListener() {
    supabaseClient
        .channel('game_changes')
        .on('postgres_changes', 
            { 
                event: '*', 
                schema: 'public', 
                table: 'games',
                filter: `id=eq.${currentGameId}`
            }, 
            handleGameUpdate
        )
        .subscribe();
}

// Обработка обновлений игры
async function handleGameUpdate(payload) {
    const game = payload.new;
    
    if (game.status === 'finished') {
        updateStatus(game.winner === playerId ? 'Вы победили!' : 'Вы проиграли!');
        return;
    }

    if (game.current_turn === playerId) {
        updateStatus('Ваш ход!');
    } else {
        updateStatus('Ход противника...');
    }

    // Обновление доски противника
    const enemyShots = isPlayer1 ? game.player2_shots : game.player1_shots;
    renderEnemyBoard(enemyShots, game[isPlayer1 ? 'player2_board' : 'player1_board']);
}

// Выстрел
async function makeShot(x, y) {
    const { data: game, error } = await supabaseClient
        .from('games')
        .select('*')
        .eq('id', currentGameId)
        .single();

    if (error) {
        console.error('Error fetching game:', error);
        return;
    }

    if (game.current_turn !== playerId) {
        alert('Не ваш ход!');
        return;
    }

    const shots = isPlayer1 ? game.player1_shots : game.player2_shots;
    const shotKey = `${x},${y}`;
    
    if (shots.some(shot => shot.x === x && shot.y === y)) {
        alert('Уже стреляли сюда!');
        return;
    }

    const enemyBoard = isPlayer1 ? game.player2_board : game.player1_board;
    const isHit = enemyBoard.some(ship => 
        ship.positions.some(pos => pos.x === x && pos.y === y)
    );

    const newShots = [...shots, { x, y, hit: isHit }];
    
    const updateData = {
        [isPlayer1 ? 'player1_shots' : 'player2_shots']: newShots,
        current_turn: isPlayer1 ? game.player2_id : game.player1_id
    };

    // Проверка победы
    if (checkWin(newShots, enemyBoard)) {
        updateData.status = 'finished';
        updateData.winner = playerId;
        await updateStats(playerId, true);
        await updateStats(isPlayer1 ? game.player2_id : game.player1_id, false);
    }

    const { error: updateError } = await supabaseClient
        .from('games')
        .update(updateData)
        .eq('id', currentGameId);

    if (updateError) {
        console.error('Error updating game:', updateError);
    }
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

function createEmptyBoard() {
    return [];
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
                cell.addEventListener('click', () => makeShot(x, y));
                cell.classList.add('hidden');
            }
            
            board.appendChild(cell);
        }
    }
}

function renderEnemyBoard(shots, enemyShips) {
    const board = document.getElementById('enemyBoard');
    const cells = board.getElementsByClassName('cell');
    
    // Сброс всех ячеек
    for (let cell of cells) {
        cell.classList.remove('hit', 'miss');
        cell.classList.add('hidden');
    }
    
    // Отображение выстрелов
    if (shots) {
        shots.forEach(shot => {
            const cell = board.querySelector(`[data-x="${shot.x}"][data-y="${shot.y}"]`);
            if (cell) {
                cell.classList.remove('hidden');
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
}

function showGame() {
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('game').style.display = 'block';
}

function updateStatus(message) {
    document.getElementById('status').textContent = message;
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', function() {
    init();
});