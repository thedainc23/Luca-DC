const Validator = require('validator');
const isEmpty = require('./is-empty.js');

module.exports = function validateLoginInput(data) {
    // Array of errot messages
  let errors = {};

//   Check if email is empty
  data.email = !isEmpty(data.field) ? data.field : '';
//   Check if password is empty
  data.password = !isEmpty(data.password) ? data.password : '';

//   if (!Validator.isEmail(data.email)) {
//     errors.email = 'Email is invalid';
//   }

  if (Validator.isEmpty(data.email)) {
    errors.email = 'Email field is required';
  }

  if (Validator.isEmpty(data.password)) {
    errors.password = 'Password field is required';
  }

  return {
    errors,
    isValid: isEmpty(errors)
  };
};