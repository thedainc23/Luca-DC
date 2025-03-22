const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 8000;


app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors());


// DC
app.use('/api/dc/', require('./routes/api/DreamCatchers/'));
app.use('/api/dc/orders', require('./routes/api/DreamCatchers/orders'));
app.use('/api/dc/customers', require('./routes/api/DreamCatchers/customers'));
app.use('/api/dc/loyalty', require('./routes/api/DreamCatchers/loyalty'));

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
