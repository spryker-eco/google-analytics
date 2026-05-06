<?php

/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

declare(strict_types = 1);

namespace SprykerEco\Zed\GoogleAnalytics\Communication\Constraint;

use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;
use Symfony\Component\Validator\Exception\UnexpectedTypeException;

class GoogleAnalyticsCredentialsJsonFormatConstraintValidator extends ConstraintValidator
{
    public function validate(mixed $value, Constraint $constraint): void
    {
        if (!$constraint instanceof GoogleAnalyticsCredentialsJsonFormatConstraint) {
            throw new UnexpectedTypeException($constraint, GoogleAnalyticsCredentialsJsonFormatConstraint::class);
        }

        if ($value === '' || $value === null) {
            return;
        }

        if (is_array(json_decode((string)$value, true))) {
            return;
        }

        $this->context->buildViolation($constraint->message)->addViolation();
    }
}
