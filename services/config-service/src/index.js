const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 9000;

app.get('/config', (req, res) => {
    res.json({
        db_url: "postgres://admin:Admin%40123@172.31.13.234:5432/appdb",
        redis_url: "redis://172.31.13.234:6379"
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Common Config API running on port ${PORT}`);
});
